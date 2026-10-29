const router = require('express').Router();
const { z }  = require('zod');
const { pool }            = require('../db');
const { wrap, HttpError } = require('../util');
const { isYm, monthRange } = require('../dates');

const schema = z.object({
  description:      z.string().trim().min(1).max(255),
  amount:           z.number().positive().max(1e10),
  transaction_type: z.enum(['income','expense']),
  transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((d)=>!Number.isNaN(Date.parse(d)),'Invalid date'),
  portfolio_id:     z.number().int().positive().nullable().optional(),
  credit_card_id:   z.number().int().positive().nullable().optional(),
  category_label:   z.string().trim().max(80).nullable().optional(),
  notes:            z.string().trim().max(500).nullable().optional(),
});

const SELECT = `
  SELECT t.transaction_id AS id, t.description, t.amount, t.transaction_type, t.transaction_date,
         t.portfolio_id, t.credit_card_id, t.notes,
         COALESCE(p.category_name, t.category_label,
           IF(t.transaction_type='income','Income','Uncategorized')) AS category,
         p.color_hex AS color
    FROM transactions t
    LEFT JOIN spend_portfolio p ON p.portfolio_id = t.portfolio_id`;

async function resolveRefs(uid, b) {
  let label = b.category_label || null;
  if (b.portfolio_id) {
    const [r] = await pool.execute(
      'SELECT category_name FROM spend_portfolio WHERE portfolio_id=? AND user_id=?',
      [b.portfolio_id, uid]);
    if (!r[0]) throw new HttpError(400,'That category does not exist');
    label = r[0].category_name;
  }
  if (b.credit_card_id) {
    const [r] = await pool.execute(
      'SELECT 1 FROM credit_cards WHERE credit_card_id=? AND user_id=?',
      [b.credit_card_id, uid]);
    if (!r[0]) throw new HttpError(400,'That card does not exist');
  }
  return label;
}

router.get('/', wrap(async (req, res) => {
  const { month, type, q, portfolio_id } = req.query;
  const limit  = Math.min(Math.max(parseInt(req.query.limit,10)||50,1),200);
  const offset = Math.max(parseInt(req.query.offset,10)||0,0);
  const where  = ['t.user_id = ?']; const args = [req.userId];
  if (month) {
    if (!isYm(month)) throw new HttpError(400,'month must look like 2026-10');
    const { start, end } = monthRange(month);
    where.push('t.transaction_date >= ? AND t.transaction_date < ?'); args.push(start, end);
  }
  if (type==='income'||type==='expense') { where.push('t.transaction_type = ?'); args.push(type); }
  if (portfolio_id) { where.push('t.portfolio_id = ?'); args.push(Number(portfolio_id)); }
  if (q) { where.push('t.description LIKE ?'); args.push(`%${String(q).slice(0,100).replace(/[%_]/g,'\\$&')}%`); }
  const sql = `${SELECT} WHERE ${where.join(' AND ')}
               ORDER BY t.transaction_date DESC, t.transaction_id DESC LIMIT ${limit} OFFSET ${offset}`;
  const [rows] = await pool.query(sql, args);
  res.json(rows);
}));

router.post('/', wrap(async (req, res) => {
  const b     = schema.parse(req.body);
  const label = await resolveRefs(req.userId, b);
  const [r]   = await pool.execute(
    `INSERT INTO transactions
       (user_id,portfolio_id,credit_card_id,description,amount,transaction_type,transaction_date,category_label,notes)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [req.userId, b.portfolio_id??null, b.credit_card_id??null, b.description, b.amount,
     b.transaction_type, b.transaction_date, label, b.notes||null]);
  const [rows] = await pool.execute(`${SELECT} WHERE t.transaction_id=? AND t.user_id=?`, [r.insertId, req.userId]);
  res.status(201).json(rows[0]);
}));

router.put('/:id', wrap(async (req, res) => {
  const b     = schema.parse(req.body);
  const label = await resolveRefs(req.userId, b);
  const [r]   = await pool.execute(
    `UPDATE transactions SET portfolio_id=?,credit_card_id=?,description=?,amount=?,
            transaction_type=?,transaction_date=?,category_label=?,notes=?
      WHERE transaction_id=? AND user_id=?`,
    [b.portfolio_id??null, b.credit_card_id??null, b.description, b.amount,
     b.transaction_type, b.transaction_date, label, b.notes||null, req.params.id, req.userId]);
  if (!r.affectedRows) throw new HttpError(404,'Transaction not found');
  const [rows] = await pool.execute(`${SELECT} WHERE t.transaction_id=? AND t.user_id=?`, [req.params.id, req.userId]);
  res.json(rows[0]);
}));

router.delete('/:id', wrap(async (req, res) => {
  const [r] = await pool.execute(
    'DELETE FROM transactions WHERE transaction_id=? AND user_id=?', [req.params.id, req.userId]);
  if (!r.affectedRows) throw new HttpError(404,'Transaction not found');
  res.status(204).end();
}));

module.exports = router;
