const router = require('express').Router();
const { pool } = require('../db');
const { wrap } = require('../util');
const { currentYm, addMonths, monthRange, daysInMonth } = require('../dates');
const { mlForecast, mlAnomalies, fallbackForecast, fallbackAnomalies } = require('../ml');

const CAT = "COALESCE(p.category_name, t.category_label, 'Uncategorized')";

router.get('/', wrap(async (req, res) => {
  const uid      = req.userId;
  const thisYm   = currentYm();
  const nextYm   = addMonths(thisYm,  1);
  const lastDone = addMonths(thisYm, -1);
  const WINDOW   = 6;                       // learn from the last 6 completed months
  const winStart = monthRange(addMonths(thisYm,-WINDOW)).start;
  const thisStart= monthRange(thisYm).start;
  const nextStart= monthRange(nextYm).start;

  const [[expRows],[incRows],[plan],[profile],[[mtd]],[txs]] = await Promise.all([
    pool.execute(
      `SELECT DATE_FORMAT(t.transaction_date,'%Y-%m') AS ym, ${CAT} AS category, SUM(t.amount) AS amount
         FROM transactions t LEFT JOIN spend_portfolio p ON p.portfolio_id=t.portfolio_id
        WHERE t.user_id=? AND t.transaction_type='expense' AND t.transaction_date>=? AND t.transaction_date<?
        GROUP BY ym,category`, [uid,winStart,thisStart]),
    pool.execute(
      `SELECT DATE_FORMAT(transaction_date,'%Y-%m') AS ym, SUM(amount) AS amount
         FROM transactions WHERE user_id=? AND transaction_type='income'
           AND transaction_date>=? AND transaction_date<? GROUP BY ym`,
      [uid,winStart,thisStart]),
    pool.execute('SELECT category_name, planned_amount FROM spend_portfolio WHERE user_id=? AND is_active=TRUE',[uid]),
    pool.execute(
      `SELECT COALESCE(p.target_savings,0) AS target, COALESCE(m.net_monthly_income,0) AS baseline
         FROM users u LEFT JOIN user_profiles p ON p.user_id=u.user_id
         LEFT JOIN monthly_income_settings m ON m.user_id=u.user_id WHERE u.user_id=?`,[uid]),
    pool.execute(
      `SELECT COALESCE(SUM(amount),0) AS spent FROM transactions
        WHERE user_id=? AND transaction_type='expense' AND transaction_date>=? AND transaction_date<?`,
      [uid,thisStart,nextStart]),
    pool.execute(
      `SELECT t.transaction_id AS id, t.description, t.amount, ${CAT} AS category, t.transaction_date AS date
         FROM transactions t LEFT JOIN spend_portfolio p ON p.portfolio_id=t.portfolio_id
        WHERE t.user_id=? AND t.transaction_type='expense'
          AND t.transaction_date >= DATE_SUB(CURDATE(), INTERVAL 180 DAY)`,[uid]),
  ]);

  const plannedMap  = new Map(plan.map((p)=>[p.category_name,p.planned_amount]));
  const plannedTotal= plan.reduce((s,p)=>s+p.planned_amount,0);
  const target      = profile[0]?.target || 0;
  const baseline    = profile[0]?.baseline || 0;
  const dayOfMonth  = new Date().getDate();
  const monthToDate = {
    spent: mtd.spent, plannedTotal,
    projected: dayOfMonth>=5 ? Math.round((mtd.spent/dayOfMonth)*daysInMonth(thisYm)) : null,
  };

  const firstYm = [...expRows,...incRows].map((r)=>r.ym).sort()[0];
  if (!firstYm||firstYm>lastDone)
    return res.json({ ready:false, nextMonth:nextYm, monthToDate,
      earlyEstimate: monthToDate.projected ? { spentSoFar: monthToDate.spent, projected: monthToDate.projected, day: dayOfMonth, daysInMonth: daysInMonth(thisYm) } : null,
      message:'The full forecast needs at least one completed month of transactions. Add transactions dated in earlier months (up to 6 months back) to unlock it.' });

  const months=[]; for(let m=firstYm;m<=lastDone;m=addMonths(m,1)) months.push(m);
  const idx=new Map(months.map((m,i)=>[m,i]));
  const series={}; const total=months.map(()=>0);
  for(const r of expRows){
    (series[r.category]||=months.map(()=>0))[idx.get(r.ym)]+=r.amount;
    total[idx.get(r.ym)]+=r.amount;
  }
  const income=months.map(()=>0);
  for(const r of incRows) income[idx.get(r.ym)]+=r.amount;

  const payload={months,series,total,income};
  const [fc,an]=await Promise.all([mlForecast(payload).catch(()=>null),mlAnomalies(txs).catch(()=>null)]);
  const forecast  =fc||fallbackForecast(payload);
  const anomalies =an||fallbackAnomalies(txs);

  const categories=forecast.categories.map((c)=>{
    const planned=plannedMap.get(c.category)||0;
    return{...c,planned,over_plan:planned>0?Math.round(c.predicted-planned):null};
  });
  const predictedIncome  = forecast.income?.predicted>0?forecast.income.predicted:baseline;
  const predictedSavings = predictedIncome-forecast.total.predicted;

  const insights=[];
  for(const c of categories.filter((x)=>x.over_plan!==null&&x.over_plan>0.05*x.planned).sort((a,b)=>b.over_plan-a.over_plan).slice(0,2))
    insights.push(`${c.category} is forecast to run about ${Math.round(c.over_plan)} over its plan next month.`);
  for(const c of categories.filter((x)=>x.trend==='up'&&x.change_pct>15&&x.predicted>0).slice(0,2))
    insights.push(`${c.category} spending has been climbing (about ${Math.round(c.change_pct)}% above your recent average).`);
  if(target>0) insights.push(predictedSavings>=target
    ?'You are on track to meet your monthly savings target.'
    :`At this pace you could miss your savings target by about ${Math.round(target-predictedSavings)}.`);
  if(monthToDate.projected&&plannedTotal>0&&monthToDate.projected>plannedTotal)
    insights.push(`This month is pacing about ${Math.round(monthToDate.projected-plannedTotal)} above your total plan.`);

  res.json({
    ready:true, engine:fc?'ml':'builtin', nextMonth:nextYm, historyMonths:months.length,
    history:{months,total,income},
    forecast:{total:forecast.total,categories,income:predictedIncome,
      savings:Math.round(predictedSavings),targetSavings:target,
      onTrack:target>0?predictedSavings>=target:null},
    monthToDate, anomalies, insights,
  });
}));

module.exports = router;
