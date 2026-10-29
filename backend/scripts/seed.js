// Gives the demo account (user_id 1) a real password and 6 months of history (Apr-Sep 2026),
// so the dashboard and the next-month forecast have data to learn from.
//   Login: soham.demo@example.com / Demo@1234
// Safe to run again: it only adds months that are still empty.
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool } = require('../src/db');

const rng = (seed) => () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

(async () => {
  const [[user]] = await pool.query('SELECT user_id FROM users WHERE user_id = 1');
  if (!user) { console.error('Demo user not found. Run database/schema.sql first.'); process.exit(1); }
  await pool.execute('UPDATE users SET password_hash = ?, email_verified_at = NOW() WHERE user_id = 1',
    [await bcrypt.hash('Demo@1234', 12)]);

  const r2 = rng(42);
  const between = (a, b) => Math.round((a + r2() * (b - a)) * 100) / 100;
  const cat = { Food: 1, Bills: 2, Shopping: 3, Transport: 4, Entertainment: 5 };
  const rows = [];
  const add = (month, day, description, amount, type, category, card = null) =>
    rows.push([1, category ? cat[category] : null, card, description, amount, type,
      `2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, category || 'Allowance']);

  const [have] = await pool.query(
    "SELECT DISTINCT MONTH(transaction_date) AS m FROM transactions WHERE user_id = 1 AND transaction_date < '2026-10-01' AND YEAR(transaction_date) = 2026");
  const done = new Set(have.map((r) => r.m));

  for (let m = 4; m <= 9; m++) {
    const k = m - 4;                                   // Food creeps upward so the model has a trend to find
    const gen = !done.has(m);                          // keep the random stream identical whether or not we insert
    const before = rows.length;
    add(m, 1, 'Monthly allowance', 15000, 'income', null);
    if (r2() > 0.4) add(m, 12, 'Freelance design work', between(1200, 3000), 'income', null);
    for (let w = 0; w < 4; w++) add(m, 3 + w * 7, 'Groceries', between(650, 900) * (1 + 0.05 * k), 'expense', 'Food');
    for (let e = 0; e < 3; e++) add(m, 6 + e * 9, 'Eating out', between(150, 420) * (1 + 0.05 * k), 'expense', 'Food');
    add(m, 5, 'Metro and bus pass', 600, 'expense', 'Transport', 1);
    for (let c = 0; c < 2; c++) add(m, 10 + c * 10, 'Cab ride', between(110, 340), 'expense', 'Transport');
    add(m, 7, 'Mobile recharge', 399, 'expense', 'Bills');
    add(m, 9, 'Internet bill', 499, 'expense', 'Bills');
    add(m, 20, 'Shopping', between(500, 1700), 'expense', 'Shopping');
    for (let e = 0; e < 2; e++) add(m, 8 + e * 12, 'Movies and subscriptions', between(150, 450), 'expense', 'Entertainment');
    if (m === 8 && gen) add(8, 23, 'Wireless headphones', 6200, 'expense', 'Shopping', 1);   // one unusual purchase for anomaly detection
    if (!gen) rows.length = before;
  }

  if (!rows.length) { console.log('All 6 months already seeded. Demo password reset to Demo@1234.'); return pool.end(); }
  await pool.query(
    `INSERT INTO transactions (user_id, portfolio_id, credit_card_id, description, amount, transaction_type,
                               transaction_date, category_label) VALUES ?`, [rows]);
  console.log(`Seeded ${rows.length} transactions. Login: soham.demo@example.com / Demo@1234`);
  await pool.end();
})().catch((e) => { console.error(e); process.exit(1); });
