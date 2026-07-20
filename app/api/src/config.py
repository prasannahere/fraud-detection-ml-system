"""Runtime configuration loaded from environment and model artifacts."""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv


def _load_repo_dotenv() -> None:
    """Load .env from the first ancestor directory that contains one."""
    for parent in Path(__file__).resolve().parents:
        env_file = parent / ".env"
        if env_file.is_file():
            load_dotenv(env_file)
            return


_load_repo_dotenv()

MODEL_PATH = Path(os.getenv("MODEL_PATH", "model/xgb95.ubj"))
ENCODERS_PATH = Path(os.getenv("ENCODERS_PATH", "model/xgb95_encoders.pkl"))
TRAINING_STATS_PATH = Path(os.getenv("TRAINING_STATS_PATH", "model/xgb95_train_stats.pkl"))
METADATA_PATH = Path(os.getenv("METADATA_PATH", "model/xgb95_metadata.json"))
THRESHOLD_PATH = Path(os.getenv("THRESHOLD_PATH", "model/xgb_threshold.json"))
FEATURES_PATH = Path(os.getenv("FEATURES_PATH", "model/xgb95_features.pkl"))


def _first_existing(*candidates: Path) -> Path | None:
    for path in candidates:
        if path.exists():
            return path
    return None


def _artifact_dir() -> Path:
    return MODEL_PATH.parent


def resolve_model_path() -> Path:
    found = _first_existing(
        MODEL_PATH,
        _artifact_dir() / "xgb95_final.ubj",
        _artifact_dir() / "fraud_model.pkl",
    )
    if found is None:
        raise FileNotFoundError(f"Missing model artifact under {_artifact_dir()}")
    return found


def resolve_encoders_path() -> Path:
    found = _first_existing(
        ENCODERS_PATH,
        _artifact_dir() / "encoders.pkl",
    )
    if found is None:
        raise FileNotFoundError(f"Missing encoders artifact under {_artifact_dir()}")
    return found


def resolve_training_stats_path() -> Path:
    found = _first_existing(
        TRAINING_STATS_PATH,
        _artifact_dir() / "training_stats.pkl",
    )
    if found is None:
        raise FileNotFoundError(f"Missing training stats artifact under {_artifact_dir()}")
    return found


def resolve_metadata_path() -> Path | None:
    return _first_existing(
        METADATA_PATH,
        _artifact_dir() / "metadata.json",
    )


def resolve_threshold_path() -> Path | None:
    return _first_existing(
        THRESHOLD_PATH,
        _artifact_dir() / "threshold.json",
    )

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
    threshold_path = resolve_threshold_path()
    if threshold_path is not None:
        with threshold_path.open() as f:
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
    metadata_path = resolve_metadata_path()
    if metadata_path is not None:
        with metadata_path.open() as f:
            loaded = json.load(f)
        defaults.update(loaded)
    return defaults


def resolve_features_path() -> Path:
    found = _first_existing(
        FEATURES_PATH,
        _artifact_dir() / "xgb95_final_features.pkl",
        _artifact_dir() / "features.pkl",
        _artifact_dir() / "feature_columns.pkl",
    )
    if found is None:
        raise FileNotFoundError(
            "Missing features artifact. Expected one of: "
            f"{FEATURES_PATH}, {_artifact_dir() / 'xgb95_final_features.pkl'}"
        )
    return found
