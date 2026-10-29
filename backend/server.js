require('dotenv').config();
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { ZodError } = require('zod');
const { pool } = require('./src/db');
const auth = require('./src/middleware/auth');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) {
  console.error('Missing JWT_SECRET. Copy .env.example to .env and set a long random value.');
  process.exit(1);
}

const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: null,
    },
  },
}));
const origins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
if (origins.length) app.use(cors({ origin: origins }));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', async (req, res) => {
  try { await pool.query('SELECT 1'); res.json({ status: 'ok' }); }
  catch { res.status(503).json({ status: 'database unavailable' }); }
});

app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false }),
  require('./src/routes/auth'));
app.use('/api/profile', auth, require('./src/routes/profile'));
app.use('/api/portfolio', auth, require('./src/routes/portfolio'));
app.use('/api/cards', auth, require('./src/routes/cards'));
app.use('/api/transactions', auth, require('./src/routes/transactions'));
app.use('/api/dashboard', auth, require('./src/routes/dashboard'));
app.use('/api/predict', auth, require('./src/routes/predict'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use(express.static(path.join(__dirname, 'public')));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err instanceof ZodError) {
    const msg = err.issues.map((i) => `${i.path.join('.') || 'value'}: ${i.message}`).join('; ');
    return res.status(400).json({ error: msg });
  }
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on our side. Please try again' });
});

const port = Number(process.env.PORT || 5000);
app.listen(port, () => console.log(`Spend Wise running at http://localhost:${port}`));
