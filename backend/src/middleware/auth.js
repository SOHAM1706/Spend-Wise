const jwt = require('jsonwebtoken');

module.exports = function auth(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Please sign in to continue' });
  try {
    req.userId = jwt.verify(token, process.env.JWT_SECRET).uid;
    next();
  } catch {
    res.status(401).json({ error: 'Your session has expired. Please sign in again' });
  }
};
