# Spend Wise

A full-stack personal finance website: sign in, track income and spending, plan a budget by category,
track credit-card due dates, and get a machine-learning forecast of next month's spending.

```
Browser  ──>  Node/Express backend (port 5000)  ──>  MySQL 8  (database/schema.sql)
              serves the website + REST API    └──>  Python ML service (port 8000)
```

## Run it

You need Node 18+, Python 3.9+ and MySQL 8.

**1. Database**
```bash
mysql -u root -p < database/schema.sql
```

**2. ML service** (keep it running in its own terminal)
```bash
cd ml-service
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8000
```

**3. Backend + website**
```bash
cd backend
npm install
cp .env.example .env        # then edit DB_PASSWORD and set JWT_SECRET to a long random string
npm run seed                # optional: demo login + 5 months of sample history for the forecast
npm start
```
Open http://localhost:5000. Demo login after seeding: `soham.demo@example.com` / `Demo@1234`.

If the ML service is not running, the website still works and the Forecast page shows a "Basic estimate" label.

## How the forecast works
`ml-service/app.py` takes each category's monthly totals and:
1. caps one-off spikes (median/MAD rule) so a single big purchase doesn't distort next month,
2. back-tests four models on the user's own history (exponential average, 3-month average, damped Holt trend, ridge regression on time),
3. uses the one with the lowest error for that category and returns a prediction with an 80% likely range.

An Isolation Forest flags unusually large expenses. Forecasts need one full past month; they get better with more (back-testing starts at 5 months).

## API (all under `/api`, JSON; everything except `/auth/*` needs `Authorization: Bearer <token>`)
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register`, `/auth/login` | Create account / sign in (returns token) |
| GET | `/auth/me` | Current user |
| GET, PUT | `/profile` | Profile, monthly income, monthly savings goal, currency |
| GET, POST | `/portfolio` | Budget categories |
| PUT, DELETE | `/portfolio/:id` | Edit / delete category |
| GET, POST | `/cards` | Credit cards (last four digits only) |
| PUT, DELETE | `/cards/:id` | Edit / remove card |
| GET, POST | `/transactions` | List (`?month=2026-10&type=expense&q=text`) / add |
| PUT, DELETE | `/transactions/:id` | Edit / delete |
| GET | `/dashboard?month=2026-10` | Totals, category spend vs plan, 6-month trend, recent, card dues |
| GET | `/predict` | Next-month forecast, insights, month-to-date pace, unusual expenses |

Using your own React frontend instead? Point it at these endpoints and send the token from `/auth/login` in the `Authorization` header.

## Security notes
Passwords are hashed with bcrypt; sessions are JWTs; every query is scoped to the signed-in user and
category/card ids are checked for ownership; inputs are validated with zod; login/register are rate-limited;
only the last four card digits are stored. For production, serve over HTTPS, use a dedicated MySQL user
(not root) and keep `.env` out of version control.

## React frontend (same existing design)

The `frontend/` folder provides a React + Vite entry point. It mounts the original Spend Wise HTML markup and keeps the existing `style.css`, assets, and `app.js` unchanged so the visible frontend and current interactions are preserved during this migration. The API requests are proxied to the existing Express server.

Run the MySQL database and ML service as described above. Then open **two terminals**:

**Terminal 1 — backend**
```powershell
cd backend
npm install
npm run dev
```

Make sure `backend/.env` has a valid `JWT_SECRET` (at least 16 characters) and the correct MySQL credentials.

**Terminal 2 — React frontend**
```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal, normally `http://127.0.0.1:5173`. Keep the backend running on port 5000. The old backend-served website remains available at `http://localhost:5000`.

**Migration note:** this preserves the existing UI and DOM-driven behavior intentionally. React now owns the frontend entry point, while the existing interaction logic remains in `public/js/app.js` to avoid changing the design or breaking features. A full component-by-component React rewrite would be a separate refactor and is not part of this design-preserving migration.
