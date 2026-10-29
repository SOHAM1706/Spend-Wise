const router = require('express').Router();
const { pool }            = require('../db');
const { wrap, HttpError } = require('../util');
const { currentYm, addMonths, monthRange, isYm, todayStr } = require('../dates');

const CAT = "COALESCE(p.category_name, t.category_label, 'Uncategorized')";

function nextDue(card, today) {
  if (card.next_due_date && card.next_due_date >= today) return card.next_due_date;
  if (!card.due_day) return null;
  const [y, m] = today.split('-').map(Number);
  for (let i = 0; i < 2; i++) {
    const last = new Date(y, m + i, 0).getDate();
    const d    = new Date(y, m - 1 + i, Math.min(card.due_day, last));
    const s    = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    if (s >= today) return s;
  }
  return null;
}

router.get('/', wrap(async (req, res) => {
  const uid   = req.userId;
  const month = req.query.month || currentYm();
  if (!isYm(month)) throw new HttpError(400,'month must look like 2026-10');
  const { start, end } = monthRange(month);
  const trendStart     = monthRange(addMonths(month, -5)).start;
  const today          = todayStr();

  const [[[totals]], [spentRows], [plan], [trendRows], [recent], [profile], [cards]] = await Promise.all([
    pool.execute(
      `SELECT COALESCE(SUM(CASE WHEN transaction_type='income' THEN amount END),0) AS income,
              COALESCE(SUM(CASE WHEN transaction_type='expense' THEN amount END),0) AS expenses
         FROM transactions WHERE user_id=? AND transaction_date>=? AND transaction_date<?`,
      [uid, start, end]),
    pool.execute(
      `SELECT ${CAT} AS category, SUM(t.amount) AS spent
         FROM transactions t LEFT JOIN spend_portfolio p ON p.portfolio_id=t.portfolio_id
        WHERE t.user_id=? AND t.transaction_type='expense' AND t.transaction_date>=? AND t.transaction_date<?
        GROUP BY category`, [uid, start, end]),
    pool.execute(
      `SELECT category_name, planned_amount, color_hex FROM spend_portfolio
        WHERE user_id=? AND is_active=TRUE ORDER BY sort_order`, [uid]),
    pool.execute(
      `SELECT DATE_FORMAT(transaction_date,'%Y-%m') AS ym, transaction_type AS type, SUM(amount) AS total
         FROM transactions WHERE user_id=? AND transaction_date>=? AND transaction_date<? GROUP BY ym,type`,
      [uid, trendStart, end]),
    pool.execute(
      `SELECT t.transaction_id AS id, t.description, t.amount, t.transaction_type, t.transaction_date,
              COALESCE(p.category_name, t.category_label, IF(t.transaction_type='income','Income','Uncategorized')) AS category
         FROM transactions t LEFT JOIN spend_portfolio p ON p.portfolio_id=t.portfolio_id
        WHERE t.user_id=? ORDER BY t.transaction_date DESC, t.transaction_id DESC LIMIT 6`, [uid]),
    pool.execute(
      `SELECT COALESCE(p.target_savings,0) AS target_savings, COALESCE(m.net_monthly_income,0) AS baseline
         FROM users u LEFT JOIN user_profiles p ON p.user_id=u.user_id
         LEFT JOIN monthly_income_settings m ON m.user_id=u.user_id WHERE u.user_id=?`, [uid]),
    pool.execute(
      `SELECT credit_card_id AS id, bank_name, last_four, card_nickname, due_day, next_due_date
         FROM credit_cards WHERE user_id=? AND is_active=TRUE`, [uid]),
  ]);

  const spentMap   = new Map(spentRows.map((r) => [r.category, r.spent]));
  const categories = plan.map((p) => ({
    name: p.category_name, color: p.color_hex, planned: p.planned_amount,
    spent: spentMap.get(p.category_name) || 0,
  }));
  const known = new Set(plan.map((p) => p.category_name));
  for (const [name, spent] of spentMap)
    if (!known.has(name)) categories.push({ name, color:'#B8C7BC', planned:0, spent });

  const income  = totals.income > 0 ? totals.income : profile[0]?.baseline || 0;
  const savings = income - totals.expenses;

  const months = Array.from({length:6}, (_,i) => addMonths(month, i-5));
  const trend  = months.map((ym) => ({
    month: ym,
    income:   trendRows.find((r) => r.ym===ym && r.type==='income')?.total  || 0,
    expenses: trendRows.find((r) => r.ym===ym && r.type==='expense')?.total || 0,
  }));

  const dues = cards.map((c) => ({ ...c, due_date: nextDue(c, today) })).filter((c) => c.due_date)
    .sort((a,b) => a.due_date.localeCompare(b.due_date)).slice(0,3);

  res.json({
    month, income, expenses: totals.expenses, savings,
    savingsRate:   income > 0 ? Math.round((savings/income)*100) : 0,
    targetSavings: profile[0]?.target_savings || 0,
    plannedTotal:  categories.reduce((s,c) => s+c.planned, 0),
    categories, trend, recent, dues,
  });
}));

module.exports = router;
