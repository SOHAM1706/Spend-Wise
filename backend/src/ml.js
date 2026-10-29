// Spending forecast.
//  1) If the Python ML service (scikit-learn) is running, use it.
//  2) Otherwise use the built-in JavaScript model below, which uses the same method:
//     cap one-off spikes, back-test four models on the user's own months, keep the best one.
const ML_URL = process.env.ML_SERVICE_URL || 'http://127.0.0.1:8000';

async function post(path, body) {
  const r = await fetch(ML_URL + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(4000),
  });
  if (!r.ok) throw new Error(`ML service responded ${r.status}`);
  return r.json();
}
const mlForecast = (payload) => post('/forecast', payload);
const mlAnomalies = (transactions) => post('/anomalies', { transactions });

/* ---------- built-in model ---------- */
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0);
const std = (a) => { const m = mean(a); return Math.sqrt(mean(a.map((v) => (v - m) ** 2))); };
const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const r2 = (n) => Math.round(n * 100) / 100;

const MODELS = {
  ewma: (y) => { let l = y[0]; for (let i = 1; i < y.length; i++) l = 0.5 * y[i] + 0.5 * l; return l; },
  mean3: (y) => mean(y.slice(-3)),
  holt_damped: (y) => {
    const a = 0.5, b = 0.3, phi = 0.9;
    let l = y[0], tr = y.length > 1 ? y[1] - y[0] : 0;
    for (let i = 1; i < y.length; i++) { const prev = l; l = a * y[i] + (1 - a) * (prev + phi * tr); tr = b * (l - prev) + (1 - b) * phi * tr; }
    return l + phi * tr;
  },
  ridge_trend: (y) => {                       // weighted ridge regression on time; recent months weigh more
    const n = y.length, scale = Math.max(mean(y), 1);
    const w = y.map((_, i) => Math.exp(n === 1 ? 0 : -1 + i / (n - 1)));
    const sw = w.reduce((s, v) => s + v, 0);
    const tm = w.reduce((s, v, i) => s + v * i, 0) / sw;
    const ym = w.reduce((s, v, i) => s + v * (y[i] / scale), 0) / sw;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) { num += w[i] * (i - tm) * (y[i] / scale - ym); den += w[i] * (i - tm) ** 2; }
    const b1 = num / (den + 1.0), b0 = ym - b1 * tm;
    return (b0 + b1 * n) * scale;
  },
};

function capOutliers(y) {                     // a single huge purchase shouldn't skew next month
  if (y.length < 5) return [y, 0];
  const med = median(y), mad = median(y.map((v) => Math.abs(v - med))) * 1.4826;
  const cap = med + 3 * Math.max(mad, 0.15 * med);
  const c = y.map((v) => Math.min(v, cap));
  return [c, y.filter((v, i) => v !== c[i]).length];
}

function seriesForecast(raw) {
  let y = raw.map((v) => Math.max(Number(v) || 0, 0));
  let capped; [y, capped] = capOutliers(y);
  const n = y.length;
  if (n === 0 || y.every((v) => v === 0))
    return { predicted: 0, low: 0, high: 0, model: 'none', backtest_mae: null, confidence: 'low', trend: 'flat', change_pct: 0, spikes_capped: 0 };

  let model, pred, errors = [], mae = null;
  if (n < 3) { model = 'mean'; pred = mean(y); }
  else if (n < 5) { model = 'ewma'; pred = MODELS.ewma(y); }
  else {
    const errs = Object.fromEntries(Object.keys(MODELS).map((k) => [k, []]));
    for (let i = 3; i < n; i++) for (const [k, fn] of Object.entries(MODELS)) errs[k].push(y[i] - Math.max(fn(y.slice(0, i)), 0));
    const maes = Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, mean(v.map(Math.abs))]));
    model = Object.keys(maes).reduce((best, k) => (maes[k] < maes[best] ? k : best));
    errors = errs[model]; mae = maes[model]; pred = MODELS[model](y);
  }
  pred = Math.max(pred, 0);
  let sigma = errors.length ? Math.sqrt(mean(errors.map((e) => e * e))) : n > 1 ? std(y) : pred * 0.3;
  sigma = Math.max(sigma, 0.05 * pred);
  const recent = mean(y.slice(-3));
  const change = recent > 0 ? ((pred - recent) / recent) * 100 : 0;
  return {
    predicted: r2(pred), low: r2(Math.max(pred - 1.28 * sigma, 0)), high: r2(pred + 1.28 * sigma),
    model, backtest_mae: mae === null ? null : r2(mae),
    confidence: n >= 8 ? 'high' : n >= 5 ? 'medium' : 'low',
    trend: change > 10 ? 'up' : change < -10 ? 'down' : 'flat', change_pct: Math.round(change * 10) / 10, spikes_capped: capped,
  };
}

function fallbackForecast({ series, total, income }) {
  const categories = Object.entries(series).map(([category, y]) => ({ category, ...seriesForecast(y) }))
    .sort((a, b) => b.predicted - a.predicted);
  const t = seriesForecast(total);
  const sum = r2(categories.reduce((s, c) => s + c.predicted, 0));
  const inc = income.some((v) => v > 0) ? seriesForecast(income) : null;
  return {
    categories,
    total: { predicted: sum, low: r2(Math.max(sum - (t.predicted - t.low), 0)), high: r2(sum + (t.high - t.predicted)), model: t.model },
    income: inc ? { predicted: inc.predicted, model: inc.model } : null,
  };
}

function fallbackAnomalies(txs) {
  const byCat = {};
  for (const t of txs) (byCat[t.category] ||= []).push(t.amount);
  return txs.map((t) => {
    const a = byCat[t.category]; if (a.length < 4) return null;
    const typical = median(a); const ratio = typical > 0 ? t.amount / typical : 0;
    return ratio >= 3 ? { ...t, typical: r2(typical), ratio: Math.round(ratio * 10) / 10 } : null;
  }).filter(Boolean).sort((a, b) => b.ratio - a.ratio).slice(0, 5);
}

module.exports = { mlForecast, mlAnomalies, fallbackForecast, fallbackAnomalies, seriesForecast };
