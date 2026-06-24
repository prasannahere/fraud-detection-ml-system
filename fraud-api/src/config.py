"""Runtime configuration loaded from environment and model artifacts."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(REPO_ROOT / ".env")

MODEL_DIR = Path(__file__).resolve().parent.parent / "model"

MODEL_UBJ = MODEL_DIR / "xgb95_final.ubj"
# Kaggle notebook saves xgb95_final_features.pkl (cell 37).
# Local xgb_train.py saves features.pkl — do not mix both in model/.
MODEL_FEATURES_PKL = MODEL_DIR / "xgb95_final_features.pkl"
FEATURES_CANDIDATES = [
    MODEL_FEATURES_PKL,
    MODEL_DIR / "features.pkl",
    MODEL_DIR / "feature_columns.pkl",
]
ENCODERS_PKL = MODEL_DIR / "encoders.pkl"
THRESHOLD_JSON = MODEL_DIR / "threshold.json"
METADATA_JSON = MODEL_DIR / "metadata.json"
TRAINING_STATS_PKL = MODEL_DIR / "training_stats.pkl"

JWT_SECRET = os.getenv("JWT_SECRET", "dev-change-me-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "60"))
AUTH_USERNAME = os.getenv("FRAUD_AUTH_USERNAME", "admin")
AUTH_PASSWORD = os.getenv("FRAUD_AUTH_PASSWORD", "admin")


def load_auth_users() -> dict[str, str]:
    """Parse FRAUD_AUTH_USERS as 'user:pass|user:pass' or fall back to single-user env vars."""
    users_raw = os.getenv("FRAUD_AUTH_USERS", "").strip()
    if users_raw:
        users: dict[str, str] = {}
        for part in users_raw.replace(",", "|").split("|"):
            part = part.strip()
            if ":" not in part:
                continue
            username, password = part.split(":", 1)
            username = username.strip()
            password = password.strip()
            if username and password:
                users[username] = password
        if users:
            return users
    return {AUTH_USERNAME: AUTH_PASSWORD}


MODEL_VERSION = os.getenv("MODEL_VERSION", "v1")
ENABLE_AUDIT = os.getenv("ENABLE_AUDIT", "false").lower() == "true"
GCP_PROJECT = os.getenv("GCP_PROJECT", "")
BIGQUERY_DATASET = os.getenv("BIGQUERY_DATASET", "fraud_ml")
BIGQUERY_TABLE = os.getenv("BIGQUERY_TABLE", "prediction_audit")


@lru_cache(maxsize=1)
def load_thresholds() -> dict[str, float]:
    defaults = {"block": 0.85, "review": 0.60, "default": 0.82}
    if THRESHOLD_JSON.exists():
        with THRESHOLD_JSON.open() as f:
            loaded = json.load(f)
        defaults.update({k: float(v) for k, v in loaded.items()})
    return defaults


@lru_cache(maxsize=1)
def load_metadata() -> dict:
    defaults = {
        "model_name": "xgboost_ieee_fraud",
        "version": MODEL_VERSION,
        "auc": None,
        "threshold": load_thresholds()["default"],
        "features": None,
    }
    if METADATA_JSON.exists():
        with METADATA_JSON.open() as f:
            loaded = json.load(f)
        defaults.update(loaded)
    return defaults


def resolve_features_path() -> Path:
    for path in FEATURES_CANDIDATES:
        if path.exists():
            return path
    raise FileNotFoundError(
        "Missing features artifact. Expected one of: "
        + ", ".join(str(p) for p in FEATURES_CANDIDATES)
    )
