"""Load model artifacts and score transactions."""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
import xgboost as xgb

from src.config import (
    ENCODERS_PKL,
    MODEL_DIR,
    MODEL_UBJ,
    MODEL_VERSION,
    load_metadata,
    load_thresholds,
    resolve_features_path,
)
from src.drift import check_drift
from src.explain import explain_prediction
from src.preprocess import FraudPreprocessor, normalize_identity_columns

logger = logging.getLogger("fraud_api.predict")

REQUIRED_RAW_COLUMNS = ["TransactionDT", "TransactionAmt"]

_model = None
_preprocessor: FraudPreprocessor | None = None
_feature_columns: list[str] | None = None
_feature_alignment: dict[str, Any] | None = None


class ArtifactError(FileNotFoundError):
    pass


class FeatureValidationError(ValueError):
    pass


def _resolve_model_path() -> Path:
    legacy = MODEL_DIR / "fraud_model.pkl"
    if MODEL_UBJ.exists():
        return MODEL_UBJ
    if legacy.exists():
        return legacy
    raise ArtifactError(f"Missing model artifact: {MODEL_UBJ}")


def _load_model(model_path: Path):
    if str(model_path).endswith(".ubj"):
        model = xgb.XGBClassifier()
        model.load_model(str(model_path))
        return model
    return joblib.load(model_path)


def _validate_feature_alignment() -> dict[str, Any]:
    assert _preprocessor is not None
    assert _feature_columns is not None

    encoder_columns = set(_preprocessor.feature_columns)
    model_columns = list(_feature_columns)
    missing = [col for col in model_columns if col not in encoder_columns]

    return {
        "aligned": len(missing) == 0,
        "model_feature_count": len(model_columns),
        "encoder_feature_count": len(_preprocessor.feature_columns),
        "missing_from_encoders": missing,
        "missing_count": len(missing),
    }


def _load_artifacts() -> None:
    global _model, _preprocessor, _feature_columns, _feature_alignment

    if _model is not None:
        return

    if not ENCODERS_PKL.exists():
        raise ArtifactError(
            f"Missing preprocessing artifact: {ENCODERS_PKL}. "
            "Run notebooks/kaggle_export_encoders_standalone.py on Kaggle after training."
        )

    model_path = _resolve_model_path()
    features_path = resolve_features_path()

    _model = _load_model(model_path)
    _preprocessor = FraudPreprocessor.load(ENCODERS_PKL)
    _feature_columns = joblib.load(features_path)
    _feature_alignment = _validate_feature_alignment()

    if not _feature_alignment["aligned"]:
        logger.warning(
            "Feature mismatch: %s model columns absent from encoders.pkl (first 5: %s). "
            "Re-export encoders on Kaggle in the same session as training. "
            "Missing columns will be filled with -1 at inference.",
            _feature_alignment["missing_count"],
            _feature_alignment["missing_from_encoders"][:5],
        )


def artifacts_status() -> dict[str, Any]:
    from src.config import FEATURES_CANDIDATES

    features_exist = any(path.exists() for path in FEATURES_CANDIDATES)
    base = {
        "model_loaded": MODEL_UBJ.exists() or (MODEL_DIR / "fraud_model.pkl").exists(),
        "encoders_loaded": ENCODERS_PKL.exists(),
        "features_loaded": features_exist,
        "features_aligned": False,
        "model_feature_count": None,
    }
    try:
        _load_artifacts()
        base["model_loaded"] = True
        base["encoders_loaded"] = True
        base["features_loaded"] = True
        if _feature_alignment:
            base["features_aligned"] = _feature_alignment["aligned"]
            base["model_feature_count"] = _feature_alignment["model_feature_count"]
    except (ArtifactError, FileNotFoundError):
        pass
    return base


def validate_raw_schema(df: pd.DataFrame) -> None:
    missing = [col for col in REQUIRED_RAW_COLUMNS if col not in df.columns]
    if missing:
        raise FeatureValidationError(f"Missing required columns: {missing}")


def score_to_decision(score: float, threshold: float | None = None) -> str:
    thresholds = load_thresholds()
    block = threshold if threshold is not None else thresholds["block"]
    review = thresholds["review"]

    if score >= block:
        return "BLOCK"
    if score >= review:
        return "REVIEW"
    return "APPROVE"


def _prepare_features(input_df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    _load_artifacts()
    assert _preprocessor is not None
    assert _feature_columns is not None

    df = normalize_identity_columns(input_df)
    validate_raw_schema(df)
    drift = check_drift(df)
    features = _preprocessor.transform(df)
    features = features.reindex(columns=_feature_columns, fill_value=-1).astype("float32")
    return df, features, drift


def predict_fraud(
    input_df: pd.DataFrame,
    threshold: float | None = None,
) -> dict[str, Any]:
    _load_artifacts()
    assert _model is not None

    _, features, drift = _prepare_features(input_df)
    scores = _model.predict_proba(features)[:, 1]
    thresholds = load_thresholds()
    threshold_used = threshold if threshold is not None else thresholds["default"]

    return {
        "fraud_probability": float(scores[0]),
        "decision": score_to_decision(float(scores[0]), threshold=threshold_used),
        "threshold_used": threshold_used,
        "model_version": MODEL_VERSION,
        "drift": drift,
    }


def predict_fraud_batch(
    input_df: pd.DataFrame,
    threshold: float | None = None,
) -> dict[str, Any]:
    _load_artifacts()
    assert _model is not None

    _, features, _ = _prepare_features(input_df)
    scores = _model.predict_proba(features)[:, 1]
    thresholds = load_thresholds()
    threshold_used = threshold if threshold is not None else thresholds["default"]

    predictions = [
        {
            "index": idx,
            "fraud_probability": float(score),
            "decision": score_to_decision(float(score), threshold=threshold_used),
        }
        for idx, score in enumerate(scores)
    ]

    return {
        "predictions": predictions,
        "threshold_used": threshold_used,
        "model_version": MODEL_VERSION,
    }


def explain_fraud(
    input_df: pd.DataFrame,
    threshold: float | None = None,
    top_k: int = 10,
) -> dict[str, Any]:
    _load_artifacts()
    assert _model is not None
    assert _feature_columns is not None

    _, features, _ = _prepare_features(input_df)
    scores = _model.predict_proba(features)[:, 1]
    thresholds = load_thresholds()
    threshold_used = threshold if threshold is not None else thresholds["default"]
    score = float(scores[0])
    explanation = explain_prediction(_model, features, _feature_columns, top_k=top_k)

    return {
        "fraud_probability": score,
        "decision": score_to_decision(score, threshold=threshold_used),
        "threshold_used": threshold_used,
        **explanation,
    }


def get_model_info() -> dict[str, Any]:
    metadata = load_metadata()
    status = artifacts_status()

    return {
        "model_name": metadata.get("model_name", "xgboost_ieee_fraud"),
        "version": metadata.get("version", MODEL_VERSION),
        "auc": metadata.get("auc"),
        "threshold": load_thresholds()["default"],
        "features": status.get("model_feature_count") or metadata.get("features"),
        "artifacts_loaded": status["model_loaded"] and status["encoders_loaded"],
        "features_aligned": status.get("features_aligned", False),
        "docker_tags": metadata.get("docker_tags", [f"fraud-api:{MODEL_VERSION}", "fraud-api:latest"]),
    }
