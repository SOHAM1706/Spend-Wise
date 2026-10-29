const router = require('express').Router();
const { z }  = require('zod');
const { pool }            = require('../db');
const { wrap, HttpError } = require('../util');

const schema = z.object({
  category_name:  z.string().trim().min(1).max(80),
  planned_amount: z.number().min(0).max(1e10),
  color_hex:      z.string().regex(/^#[0-9A-Fa-f]{6}$/).default('#3A6B4C'),
});
const dup = (e) => { if (e.code==='ER_DUP_ENTRY') throw new HttpError(409,'You already have a category with that name'); throw e; };

router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT portfolio_id AS id, category_name, planned_amount, color_hex, sort_order
       FROM spend_portfolio WHERE user_id=? AND is_active=TRUE ORDER BY sort_order, category_name`,
    [req.userId]);
  res.json(rows);
}));

router.post('/', wrap(async (req, res) => {
  const b = schema.parse(req.body);
  try {
    const [[{ next }]] = await pool.execute(
      'SELECT COALESCE(MAX(sort_order),0)+1 AS next FROM spend_portfolio WHERE user_id=?', [req.userId]);
    const [r] = await pool.execute(
      `INSERT INTO spend_portfolio (user_id, category_name, planned_amount, color_hex, sort_order)
       VALUES (?,?,?,?,?)`, [req.userId, b.category_name, b.planned_amount, b.color_hex, next]);
    res.status(201).json({ id: r.insertId, ...b });
  } catch (e) { dup(e); }
}));

router.put('/:id', wrap(async (req, res) => {
  const b = schema.parse(req.body);
  try {
    const [r] = await pool.execute(
      `UPDATE spend_portfolio SET category_name=?, planned_amount=?, color_hex=?
        WHERE portfolio_id=? AND user_id=?`,
      [b.category_name, b.planned_amount, b.color_hex, req.params.id, req.userId]);
    if (!r.affectedRows) throw new HttpError(404,'Category not found');
    await pool.execute('UPDATE transactions SET category_label=? WHERE portfolio_id=? AND user_id=?',
      [b.category_name, req.params.id, req.userId]);
    res.json({ id: Number(req.params.id), ...b });
  } catch (e) { dup(e); }
}));

router.delete('/:id', wrap(async (req, res) => {
  const [r] = await pool.execute(
    'DELETE FROM spend_portfolio WHERE portfolio_id=? AND user_id=?', [req.params.id, req.userId]);
  if (!r.affectedRows) throw new HttpError(404,'Category not found');
  res.status(204).end();
}));

module.exports = router;
