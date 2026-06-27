"""Train XGBoost on IEEE-CIS data and export deployment artifacts."""

from __future__ import annotations

import argparse
import gc
import json
import os
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
import xgboost as xgb
from sklearn.metrics import roc_auc_score

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from shared.drift import save_training_stats  # noqa: E402
from shared.preprocess import FraudPreprocessor, load_ieee_data  # noqa: E402

DEFAULT_THRESHOLDS = {"block": 0.85, "review": 0.60, "default": 0.82}

GCS_DATA_BUCKET = os.environ.get(
    "GCS_DATA_BUCKET",
    os.environ.get("GCS_ARTIFACTS_BUCKET", "fraud-detection-500117-artifacts"),
)
GCS_DATA_PREFIX = os.environ.get("GCS_DATA_PREFIX", "data/data")


def default_data_path(filename: str) -> Path:
    """GCS FUSE path for IEEE-CIS CSVs (Vertex / Cloud Storage mount)."""
    return Path(f"/gcs/{GCS_DATA_BUCKET}/{GCS_DATA_PREFIX}/{filename}")


def default_output_dir() -> Path:
    """Vertex AI sets AIP_MODEL_DIR; fall back to local API model dir."""
    if env := os.environ.get("AIP_MODEL_DIR"):
        return Path(env)
    return ROOT / "app" / "api" / "model"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train fraud model and export API artifacts")
    parser.add_argument(
        "--train-transaction",
        type=Path,
        default=default_data_path("train_transaction.csv"),
        help=f"Train transaction CSV (default: /gcs/{GCS_DATA_BUCKET}/{GCS_DATA_PREFIX}/train_transaction.csv)",
    )
    parser.add_argument(
        "--train-identity",
        type=Path,
        default=default_data_path("train_identity.csv"),
    )
    parser.add_argument(
        "--test-transaction",
        type=Path,
        default=default_data_path("test_transaction.csv"),
    )
    parser.add_argument(
        "--test-identity",
        type=Path,
        default=default_data_path("test_identity.csv"),
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help="Artifact directory (defaults to AIP_MODEL_DIR or app/api/model)",
    )
    parser.add_argument(
        "--model-version",
        default=os.environ.get("MODEL_VERSION", "v1"),
        help="Version string stored in xgb95_metadata.json",
    )
    parser.add_argument(
        "--fit-with-test",
        action="store_true",
        help="Include test split when fitting encoders (Kaggle-style; not recommended for production)",
    )
    parser.add_argument(
        "--valid-fraction",
        type=float,
        default=0.25,
        help="Fraction of training rows held out for temporal validation (default: 0.25)",
    )
    parser.add_argument("--n-estimators", type=int, default=2000)
    parser.add_argument("--learning-rate", type=float, default=0.02)
    parser.add_argument("--max-depth", type=int, default=12)
    return parser.parse_args()


def optimize_dtypes(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for col in out.columns:
        if out[col].dtype == np.float64:
            out[col] = out[col].astype(np.float32)
        elif out[col].dtype == np.int64:
            out[col] = out[col].astype(np.int32)
    return out


def temporal_train_valid_indices(
    df: pd.DataFrame,
    valid_fraction: float,
) -> tuple[pd.Index, pd.Index]:
    """Hold out the most recent transactions by TransactionDT for validation."""
    if "TransactionDT" not in df.columns:
        raise ValueError("TransactionDT column required for temporal validation split")

    ordered = df.sort_values("TransactionDT")
    n_valid = max(1, int(len(ordered) * valid_fraction))
    idx_valid = ordered.index[-n_valid:]
    idx_train = ordered.index[:-n_valid]
    if len(idx_train) == 0:
        raise ValueError("valid_fraction too large; no rows left for training")
    return idx_train, idx_valid


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n")


def train_and_export(args: argparse.Namespace) -> None:
    output_dir = args.output_dir or default_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)

    x_train, y_train, x_test = load_ieee_data(
        args.train_transaction,
        args.train_identity,
        args.test_transaction,
        args.test_identity,
    )

    idx_train, idx_valid = temporal_train_valid_indices(x_train, args.valid_fraction)
    x_fit = x_train.loc[idx_train]
    y_fit = y_train.loc[idx_train]
    y_valid = y_train.loc[idx_valid]

    preprocessor = FraudPreprocessor()
    if args.fit_with_test:
        preprocessor.fit(x_fit, x_test)
    else:
        preprocessor.fit(x_fit)

    save_training_stats(x_fit, output_dir / "xgb95_train_stats.pkl")

    x_fit = optimize_dtypes(preprocessor.transform(x_fit))
    x_valid = optimize_dtypes(preprocessor.transform(x_train.loc[idx_valid]))
    feature_columns = preprocessor.feature_columns
    y_fit = y_fit.astype(np.int8)
    y_valid = y_valid.astype(np.int8)

    split_dt_train_max = float(x_train.loc[idx_train, "TransactionDT"].max())
    split_dt_valid_min = float(x_train.loc[idx_valid, "TransactionDT"].min())

    model = xgb.XGBClassifier(
        n_estimators=args.n_estimators,
        max_depth=args.max_depth,
        learning_rate=args.learning_rate,
        subsample=0.8,
        colsample_bytree=0.4,
        missing=-1,
        eval_metric="auc",
        tree_method="hist",
        early_stopping_rounds=100,
    )

    model.fit(
        x_fit[feature_columns],
        y_fit,
        eval_set=[(x_valid[feature_columns], y_valid)],
        verbose=50,
    )

    valid_probs = model.predict_proba(x_valid[feature_columns])[:, 1]
    valid_auc = float(roc_auc_score(y_valid, valid_probs))

    model.save_model(output_dir / "xgb95.ubj")
    preprocessor.save(output_dir / "xgb95_encoders.pkl")
    joblib.dump(feature_columns, output_dir / "xgb95_features.pkl")

    write_json(
        output_dir / "xgb95_metadata.json",
        {
            "model_name": "xgboost_ieee_fraud",
            "version": args.model_version,
            "auc": round(valid_auc, 4),
            "threshold": DEFAULT_THRESHOLDS["default"],
            "features": len(feature_columns),
            "trained_on": "IEEE-CIS Fraud Detection",
            "algorithm": "XGBoost",
            "best_iteration": int(getattr(model, "best_iteration", model.n_estimators)),
            "validation_split": "temporal",
            "valid_fraction": args.valid_fraction,
            "train_rows": int(len(idx_train)),
            "valid_rows": int(len(idx_valid)),
            "split_transaction_dt": {
                "train_max": split_dt_train_max,
                "valid_min": split_dt_valid_min,
            },
        },
    )
    write_json(output_dir / "xgb_threshold.json", DEFAULT_THRESHOLDS)

    print(f"Saved model artifacts to {output_dir}")
    print("  xgb95.ubj")
    print("  xgb95_encoders.pkl")
    print("  xgb95_features.pkl")
    print("  xgb95_train_stats.pkl")
    print("  xgb95_metadata.json")
    print("  xgb_threshold.json")
    print(f"Temporal split: {len(idx_train)} train / {len(idx_valid)} valid rows")
    print(f"Validation AUC: {valid_auc:.4f}")
    print(f"Feature count: {len(feature_columns)}")

    del model, x_train, y_train, x_test, preprocessor, x_fit, x_valid
    gc.collect()


if __name__ == "__main__":
    train_and_export(parse_args())
