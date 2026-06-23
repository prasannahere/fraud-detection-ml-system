"""Input drift checks against training reference statistics."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from src.config import TRAINING_STATS_PKL

MONITORED_FEATURES = [
    "TransactionAmt",
    "card1_FE",
    "card2_FE",
    "addr1_FE",
    "P_emaildomain_FE",
    "D11",
    "D9",
    "cents",
]

DRIFT_STATUS_THRESHOLDS = {"stable": 0.10, "moderate": 0.20}


def load_training_stats() -> dict[str, dict[str, float]] | None:
    if not TRAINING_STATS_PKL.exists():
        return None
    return joblib.load(TRAINING_STATS_PKL)


def save_training_stats(df: pd.DataFrame, path: Path | None = None) -> None:
    target = path or TRAINING_STATS_PKL
    numeric = df.select_dtypes(include=[np.number])
    stats = {
        col: {
            "mean": float(numeric[col].mean()),
            "std": float(numeric[col].std() or 1.0),
            "p05": float(numeric[col].quantile(0.05)),
            "p95": float(numeric[col].quantile(0.95)),
        }
        for col in numeric.columns
    }
    joblib.dump(stats, target)


def check_drift(raw_df: pd.DataFrame, z_threshold: float = 3.0) -> dict[str, Any]:
    reference = load_training_stats()
    if reference is None:
        return {"drift_detected": False, "message": "No training_stats.pkl; drift check skipped", "columns": []}

    alerts: list[dict[str, Any]] = []
    numeric = raw_df.select_dtypes(include=[np.number])

    for col, ref in reference.items():
        if col not in numeric.columns:
            continue
        value = float(numeric[col].iloc[0])
        mean = ref["mean"]
        std = ref["std"] or 1.0
        z_score = abs((value - mean) / std)
        if z_score > z_threshold or value < ref["p05"] or value > ref["p95"]:
            alerts.append(
                {
                    "column": col,
                    "value": value,
                    "training_mean": mean,
                    "training_std": std,
                    "z_score": round(z_score, 3),
                }
            )

    return {
        "drift_detected": bool(alerts),
        "columns": alerts,
    }


def _drift_status(score: float) -> str:
    if score < DRIFT_STATUS_THRESHOLDS["stable"]:
        return "Stable"
    if score < DRIFT_STATUS_THRESHOLDS["moderate"]:
        return "Moderate Drift"
    return "High Drift"


def _feature_drift_score(values: pd.Series, ref: dict[str, float]) -> float:
    """Approximate distribution shift using mean/std divergence (PSI proxy)."""
    clean = pd.to_numeric(values, errors="coerce").dropna()
    if clean.empty:
        return 0.0

    batch_mean = float(clean.mean())
    batch_std = float(clean.std() or 1e-6)
    train_mean = ref["mean"]
    train_std = ref["std"] or 1e-6

    mean_shift = abs(batch_mean - train_mean) / max(train_std, 1e-6)
    std_ratio = max(batch_std / max(train_std, 1e-6), max(train_std, 1e-6) / max(batch_std, 1e-6))
    std_shift = max(0.0, std_ratio - 1.0)

    p05, p95 = ref.get("p05", train_mean - 2 * train_std), ref.get("p95", train_mean + 2 * train_std)
    outside = float(((clean < p05) | (clean > p95)).mean())

    score = 0.5 * min(1.0, mean_shift / 3.0) + 0.3 * min(1.0, std_shift / 2.0) + 0.2 * outside
    return round(min(1.0, score), 3)


def compute_feature_drift(
    raw_df: pd.DataFrame,
    features_df: pd.DataFrame | None = None,
) -> dict[str, Any]:
    """Batch drift monitor for key IEEE-CIS features vs training reference."""
    reference = load_training_stats()
    if reference is None:
        return {
            "drift_detected": False,
            "high_drift_count": 0,
            "message": "No training_stats.pkl; drift monitoring unavailable",
            "features": [],
        }

    engineered = features_df if features_df is not None else pd.DataFrame()
    rows: list[dict[str, Any]] = []

    for feature in MONITORED_FEATURES:
        source = engineered if feature in engineered.columns else raw_df
        if feature not in source.columns:
            continue

        ref = reference.get(feature)
        if ref is None:
            continue

        values = source[feature]
        score = _feature_drift_score(values, ref)
        rows.append(
            {
                "feature": feature,
                "drift_score": score,
                "status": _drift_status(score),
                "batch_mean": round(float(pd.to_numeric(values, errors="coerce").mean()), 4),
                "training_mean": round(ref["mean"], 4),
            }
        )

    rows.sort(key=lambda item: item["drift_score"], reverse=True)
    high_drift = sum(1 for row in rows if row["status"] == "High Drift")

    return {
        "drift_detected": high_drift > 0 or any(row["status"] == "Moderate Drift" for row in rows),
        "high_drift_count": high_drift,
        "message": None,
        "features": rows,
    }
