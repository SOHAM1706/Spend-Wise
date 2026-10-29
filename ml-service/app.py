"""
Spend Wise ML service.

/forecast   Predicts next month's spending for each category (and in total) from monthly history.
            For every series it back-tests four models on the user's own past months and uses the
            one with the lowest error, so a user with a steady budget and a user with a rising
            food bill each get the model that fits them.
/anomalies  Flags unusually large expenses with an Isolation Forest.

Run:  uvicorn app:app --host 127.0.0.1 --port 8000
"""
from typing import Dict, List, Optional

import numpy as np
from fastapi import FastAPI
from pydantic import BaseModel
from sklearn.ensemble import IsolationForest
from sklearn.linear_model import Ridge

app = FastAPI(title="Spend Wise ML service")


# ---------- candidate models: each maps a history list -> next-period prediction ----------
def m_ewma(y: List[float], a: float = 0.5) -> float:
    """Exponentially weighted average: good for stable spending."""
    level = y[0]
    for v in y[1:]:
        level = a * v + (1 - a) * level
    return float(level)


def m_mean3(y: List[float]) -> float:
    """Average of the last three months."""
    return float(np.mean(y[-3:]))


def m_holt(y: List[float], a: float = 0.5, b: float = 0.3, phi: float = 0.9) -> float:
    """Damped Holt (level + trend): follows a rising or falling pattern without overshooting."""
    level, trend = y[0], (y[1] - y[0]) if len(y) > 1 else 0.0
    for v in y[1:]:
        prev = level
        level = a * v + (1 - a) * (prev + phi * trend)
        trend = b * (level - prev) + (1 - b) * phi * trend
    return float(level + phi * trend)


def m_ridge(y: List[float]) -> float:
    """Ridge regression on time, weighting recent months more."""
    n = len(y)
    t = np.arange(n, dtype=float).reshape(-1, 1)
    scale = max(float(np.mean(y)), 1.0)
    weights = np.exp(np.linspace(-1.0, 0.0, n))
    model = Ridge(alpha=1.0).fit(t, np.asarray(y) / scale, sample_weight=weights)
    return float(model.predict([[float(n)]])[0] * scale)


MODELS = {"ewma": m_ewma, "mean3": m_mean3, "holt_damped": m_holt, "ridge_trend": m_ridge}
Z80 = 1.28  # ~80% prediction interval


def cap_outliers(y: List[float]):
    """Cap one-off spikes (e.g. a single big purchase) so they don't distort next month's forecast.
    Uses the median and MAD, which a single outlier cannot move. Returns (series, number capped)."""
    if len(y) < 5:
        return y, 0
    med = float(np.median(y))
    mad = float(np.median(np.abs(np.asarray(y) - med))) * 1.4826
    cap = med + 3 * max(mad, 0.15 * med)
    capped = [min(v, cap) for v in y]
    return capped, sum(1 for a, b in zip(y, capped) if a != b)


def forecast_series(raw: List[float]) -> dict:
    y = [max(float(v), 0.0) for v in raw]
    y, n_capped = cap_outliers(y)
    n = len(y)
    if n == 0 or sum(y) == 0:
        return dict(predicted=0.0, low=0.0, high=0.0, model="none", backtest_mae=None,
                    confidence="low", trend="flat", change_pct=0.0, spikes_capped=0)

    errors: List[float] = []
    mae: Optional[float] = None
    if n < 3:
        model, pred = "mean", float(np.mean(y))
    elif n < 5:
        model, pred = "ewma", MODELS["ewma"](y)           # too little history to back-test
    else:
        # rolling-origin back-test: predict months 4..n from the months before each one
        errs = {name: [] for name in MODELS}
        for i in range(3, n):
            for name, fn in MODELS.items():
                errs[name].append(y[i] - max(fn(y[:i]), 0.0))
        maes = {k: float(np.mean(np.abs(v))) for k, v in errs.items()}
        model = min(maes, key=maes.get)                    # ties keep the simpler model (ewma first)
        mae, errors = maes[model], errs[model]
        pred = MODELS[model](y)

    pred = max(pred, 0.0)
    if errors:
        sigma = float(np.sqrt(np.mean(np.square(errors))))
    else:
        sigma = float(np.std(y)) if n > 1 else pred * 0.3
    sigma = max(sigma, 0.05 * pred)

    recent = float(np.mean(y[-3:]))
    change = (pred - recent) / recent * 100 if recent > 0 else 0.0
    return dict(
        predicted=round(pred, 2),
        low=round(max(pred - Z80 * sigma, 0.0), 2),
        high=round(pred + Z80 * sigma, 2),
        model=model,
        backtest_mae=round(mae, 2) if mae is not None else None,
        confidence="high" if n >= 8 else "medium" if n >= 5 else "low",
        trend="up" if change > 10 else "down" if change < -10 else "flat",
        change_pct=round(change, 1),
        spikes_capped=n_capped,
    )


class ForecastIn(BaseModel):
    months: List[str] = []
    series: Dict[str, List[float]] = {}
    total: List[float] = []
    income: List[float] = []


@app.post("/forecast")
def forecast(body: ForecastIn):
    cats = [{"category": name, **forecast_series(ys)} for name, ys in body.series.items()]
    cats.sort(key=lambda c: -c["predicted"])

    t = forecast_series(body.total)
    total_pred = round(sum(c["predicted"] for c in cats), 2)
    total = {
        "predicted": total_pred,
        "low": round(max(total_pred - (t["predicted"] - t["low"]), 0.0), 2),
        "high": round(total_pred + (t["high"] - t["predicted"]), 2),
        "model": t["model"],
    }
    income = None
    if any(v > 0 for v in body.income):
        r = forecast_series(body.income)
        income = {"predicted": r["predicted"], "model": r["model"]}
    return {"categories": cats, "total": total, "income": income}


class Tx(BaseModel):
    id: int
    amount: float
    category: str
    date: str
    description: str = ""


class AnomalyIn(BaseModel):
    transactions: List[Tx] = []


@app.post("/anomalies")
def anomalies(body: AnomalyIn):
    txs = body.transactions
    if len(txs) < 15:
        return []
    amounts = np.array([t.amount for t in txs], dtype=float)
    global_med = float(np.median(amounts))
    med: Dict[str, float] = {}
    for c in {t.category for t in txs}:
        vals = [t.amount for t in txs if t.category == c]
        med[c] = float(np.median(vals)) if len(vals) >= 3 else global_med
    ratio = np.array([a / max(med[t.category], 1.0) for a, t in zip(amounts, txs)])

    # two features: how big the amount is, and how big it is relative to its own category
    X = np.column_stack([np.log1p(amounts), np.log1p(ratio)])
    contamination = float(min(0.1, max(0.02, 3 / len(txs))))
    labels = IsolationForest(n_estimators=200, contamination=contamination, random_state=42).fit_predict(X)

    out = [
        {"id": t.id, "description": t.description, "amount": round(t.amount, 2), "category": t.category,
         "date": t.date, "typical": round(med[t.category], 2), "ratio": round(float(r), 1)}
        for t, r, lab in zip(txs, ratio, labels) if lab == -1 and r >= 2.0
    ]
    return sorted(out, key=lambda x: -x["ratio"])[:5]


@app.get("/health")
def health():
    return {"status": "ok"}
