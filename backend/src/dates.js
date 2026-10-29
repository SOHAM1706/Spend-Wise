const pad = (n) => String(n).padStart(2, '0');

function currentYm() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
function addMonths(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
// [start, end) range as 'YYYY-MM-DD' strings
function monthRange(ym) {
  return { start: `${ym}-01`, end: `${addMonths(ym, 1)}-01` };
}
function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const isYm = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');

module.exports = { currentYm, addMonths, monthRange, daysInMonth, todayStr, isYm };
