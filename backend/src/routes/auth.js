const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { z }  = require('zod');
const { pool }         = require('../db');
const { wrap, HttpError } = require('../util');
const auth             = require('../middleware/auth');

const DEFAULT_CATEGORIES = [
  ['Food','#3A6B4C'],['Bills','#5A8F6A'],['Shopping','#D2E4D4'],
  ['Transport','#22422E'],['Entertainment','#87A992'],
];
const registerSchema = z.object({
  full_name:          z.string().trim().min(1).max(120),
  email:              z.string().trim().toLowerCase().email().max(254),
  password:           z.string().min(8).max(72)
    .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Password needs a letter and a number'),
  age:                z.number().int().min(1).max(120).nullable().optional(),
  occupation:         z.string().trim().max(120).nullable().optional(),
  net_monthly_income: z.number().min(0).max(1e10).optional(),
  target_savings:     z.number().min(0).max(1e10).optional(),
});
const loginSchema = z.object({
  email:    z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(72),
});
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12);
const sign      = (uid) => jwt.sign({ uid }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
const publicUser = (u)  => ({ id: u.user_id, full_name: u.full_name, email: u.email });

router.post('/register', wrap(async (req, res) => {
  const b    = registerSchema.parse(req.body);
  const hash = await bcrypt.hash(b.password, 12);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [r] = await conn.execute(
      'INSERT INTO users (full_name, email, password_hash) VALUES (?, ?, ?)',
      [b.full_name, b.email, hash]);
    const uid = r.insertId;
    await conn.execute(
      'INSERT INTO user_profiles (user_id, age, occupation, target_savings) VALUES (?, ?, ?, ?)',
      [uid, b.age ?? null, b.occupation ?? null, b.target_savings ?? 0]);
    await conn.execute(
      'INSERT INTO monthly_income_settings (user_id, net_monthly_income) VALUES (?, ?)',
      [uid, b.net_monthly_income ?? 0]);
    await conn.query(
      'INSERT INTO spend_portfolio (user_id, category_name, planned_amount, color_hex, sort_order) VALUES ?',
      [DEFAULT_CATEGORIES.map(([name, color], i) => [uid, name, 0, color, i + 1])]);
    await conn.commit();
    res.status(201).json({ token: sign(uid), user: { id: uid, full_name: b.full_name, email: b.email } });
  } catch (e) {
    await conn.rollback();
    if (e.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'An account with this email already exists');
    throw e;
  } finally { conn.release(); }
}));

router.post('/login', wrap(async (req, res) => {
  const { email, password } = loginSchema.parse(req.body);
  const [rows] = await pool.execute(
    'SELECT user_id, full_name, email, password_hash, is_active FROM users WHERE email = ?', [email]);
  const u  = rows[0];
  const ok = await bcrypt.compare(password, u ? u.password_hash : DUMMY_HASH);
  if (!u || !ok || !u.is_active) throw new HttpError(401, 'Incorrect email or password');
  res.json({ token: sign(u.user_id), user: publicUser(u) });
}));

router.get('/me', auth, wrap(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT u.user_id, u.full_name, u.email, p.currency_code
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.user_id
      WHERE u.user_id = ? AND u.is_active = TRUE`, [req.userId]);
  if (!rows[0]) throw new HttpError(401, 'Account not found');
  res.json({ ...publicUser(rows[0]), currency: rows[0].currency_code || 'INR' });
}));

module.exports = router;
