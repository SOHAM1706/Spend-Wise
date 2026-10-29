const router = require('express').Router();
const { z }  = require('zod');
const { pool }            = require('../db');
const { wrap, HttpError } = require('../util');

const schema = z.object({
  bank_name:     z.string().trim().min(1).max(100),
  last_four:     z.string().regex(/^\d{4}$/,'Enter exactly the last 4 digits'),
  holder_name:   z.string().trim().min(1).max(120),
  due_day:       z.number().int().min(1).max(31).nullable().optional(),
  next_due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  card_nickname: z.string().trim().max(60).nullable().optional(),
});
const vals = (b) => [b.bank_name, b.last_four, b.holder_name, b.due_day??null, b.next_due_date||null, b.card_nickname||null];

router.get('/', wrap(async (req, res) => {
  const [rows] = await pool.execute(
    `SELECT credit_card_id AS id, bank_name, last_four, holder_name, due_day, next_due_date, card_nickname
       FROM credit_cards WHERE user_id=? AND is_active=TRUE ORDER BY created_at`, [req.userId]);
  res.json(rows);
}));

router.post('/', wrap(async (req, res) => {
  const b = schema.parse(req.body);
  const [r] = await pool.execute(
    `INSERT INTO credit_cards (user_id,bank_name,last_four,holder_name,due_day,next_due_date,card_nickname)
     VALUES (?,?,?,?,?,?,?)`, [req.userId, ...vals(b)]);
  res.status(201).json({ id: r.insertId, ...b });
}));

router.put('/:id', wrap(async (req, res) => {
  const b = schema.parse(req.body);
  const [r] = await pool.execute(
    `UPDATE credit_cards SET bank_name=?,last_four=?,holder_name=?,due_day=?,next_due_date=?,card_nickname=?
      WHERE credit_card_id=? AND user_id=? AND is_active=TRUE`, [...vals(b), req.params.id, req.userId]);
  if (!r.affectedRows) throw new HttpError(404,'Card not found');
  res.json({ id: Number(req.params.id), ...b });
}));

router.delete('/:id', wrap(async (req, res) => {
  const [r] = await pool.execute(
    'UPDATE credit_cards SET is_active=FALSE WHERE credit_card_id=? AND user_id=?', [req.params.id, req.userId]);
  if (!r.affectedRows) throw new HttpError(404,'Card not found');
  res.status(204).end();
}));

module.exports = router;
