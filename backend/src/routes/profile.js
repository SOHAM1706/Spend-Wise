const router = require('express').Router();
const { z }  = require('zod');
const { pool }    = require('../db');
const { wrap }    = require('../util');

const schema = z.object({
  full_name:          z.string().trim().min(1).max(120),
  age:                z.number().int().min(1).max(120).nullable().optional(),
  occupation:         z.string().trim().max(120).nullable().optional(),
  financial_bio:      z.string().trim().max(500).nullable().optional(),
  target_savings:     z.number().min(0).max(1e10),
  net_monthly_income: z.number().min(0).max(1e10),
  currency_code:      z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/).default('INR'),
});

async function load(uid) {
  const [rows] = await pool.execute(
    `SELECT u.full_name, u.email, p.age, p.occupation, p.financial_bio, p.currency_code,
            COALESCE(p.target_savings,0) AS target_savings,
            COALESCE(m.net_monthly_income,0) AS net_monthly_income
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id = u.user_id
       LEFT JOIN monthly_income_settings m ON m.user_id = u.user_id
      WHERE u.user_id = ?`, [uid]);
  return rows[0];
}

router.get('/', wrap(async (req, res) => res.json(await load(req.userId))));

router.put('/', wrap(async (req, res) => {
  const b    = schema.parse(req.body);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute('UPDATE users SET full_name = ? WHERE user_id = ?', [b.full_name, req.userId]);
    await conn.execute(
      `INSERT INTO user_profiles (user_id, age, occupation, financial_bio, target_savings, currency_code)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE age=VALUES(age), occupation=VALUES(occupation),
         financial_bio=VALUES(financial_bio), target_savings=VALUES(target_savings),
         currency_code=VALUES(currency_code)`,
      [req.userId, b.age??null, b.occupation??null, b.financial_bio??null, b.target_savings, b.currency_code]);
    await conn.execute(
      `INSERT INTO monthly_income_settings (user_id, net_monthly_income) VALUES (?,?)
       ON DUPLICATE KEY UPDATE net_monthly_income=VALUES(net_monthly_income)`,
      [req.userId, b.net_monthly_income]);
    await conn.commit();
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  res.json(await load(req.userId));
}));

module.exports = router;
