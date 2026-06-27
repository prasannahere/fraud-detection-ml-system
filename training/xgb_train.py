"""Train XGBoost on labeled IEEE-CIS data and export deployment artifacts."""

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

LOCAL_DATA_DIR = ROOT / "data"
LOCAL_MODEL_DIR = ROOT / "models"


def gcs_fuse_path(uri_or_path: str | Path) -> Path:
    """Map gs:// URIs to Vertex Cloud Storage FUSE paths (/gcs/bucket/...)."""
    text = str(uri_or_path)
    if text.startswith("gs://"):
        return Path("/gcs") / text[5:]
    return Path(uri_or_path)


def normalize_output_dir(uri_or_path: str | Path) -> Path:
    """Resolve output dir; strip Vertex AIP_MODEL_DIR trailing /model segment."""
    path = gcs_fuse_path(uri_or_path)
    if path.name == "model":
        return path.parent
    return path


def gcs_artifacts_root() -> Path | None:
    bucket = os.environ.get("GCS_ARTIFACTS_BUCKET")
    if not bucket:
        return None
    return Path(f"/gcs/{bucket}")


def default_data_path(filename: str) -> Path:
    root = gcs_artifacts_root()
    if root is not None:
        prefix = os.environ.get("GCS_DATA_PREFIX", "data")
        return root / prefix / filename
    return LOCAL_DATA_DIR / filename


def default_output_dir() -> Path:
    root = gcs_artifacts_root()
    if root is not None:
        prefix = os.environ.get("OUTPUT_PREFIX", "models/xgb95")
        return root / prefix
    return LOCAL_MODEL_DIR


def resolve_path(
    cli: Path | None,
    env_var: str,
    default: Path,
    *,
    output: bool = False,
) -> Path:
    """CLI > environment variable > default."""
    if cli is not None:
        return normalize_output_dir(cli) if output else gcs_fuse_path(cli)
    if env := os.environ.get(env_var):
        return normalize_output_dir(env) if output else gcs_fuse_path(env)
    return default


def resolve_paths(args: argparse.Namespace) -> argparse.Namespace:
    args.train_transaction = resolve_path(
        args.train_transaction,
        "TRAIN_TRANSACTION_PATH",
        default_data_path("train_transaction.csv"),
    )
    args.train_identity = resolve_path(
        args.train_identity,
        "TRAIN_IDENTITY_PATH",
        default_data_path("train_identity.csv"),
    )
    args.output_dir = resolve_path(
        args.output_dir,
        "AIP_MODEL_DIR",
        default_output_dir(),
        output=True,
    )
    return args


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train XGBoost fraud model on labeled data and export artifacts",
    )

    data = parser.add_argument_group("data")
    data.add_argument(
        "--train-transaction",
        type=Path,
        default=None,
        help=(
            "Train transaction CSV (default: TRAIN_TRANSACTION_PATH, "
            "GCS_ARTIFACTS_BUCKET/data/..., or ./data/train_transaction.csv)"
        ),
    )
    data.add_argument(
        "--train-identity",
        type=Path,
        default=None,
        help=(
            "Train identity CSV (default: TRAIN_IDENTITY_PATH, "
            "GCS_ARTIFACTS_BUCKET/data/..., or ./data/train_identity.csv)"
        ),
    )

    split = parser.add_argument_group("validation split")
    split.add_argument(
        "--split-method",
        choices=("temporal", "index"),
        default="temporal",
        help="temporal=hold out latest TransactionDT rows; index=last N%% by row order",
    )
    split.add_argument(
        "--valid-fraction",
        type=float,
        default=0.25,
        help="Fraction of labeled rows held out for validation (default: 0.25)",
    )
    split.add_argument(
        "--train-on-all",
        action=argparse.BooleanOptionalAction,
        default=True,
        help="After validation, retrain final model on all labeled rows (default: true)",
    )

    xgb_group = parser.add_argument_group("xgboost")
    xgb_group.add_argument("--n-estimators", type=int, default=5000)
    xgb_group.add_argument("--learning-rate", type=float, default=0.02)
    xgb_group.add_argument("--max-depth", type=int, default=12)
    xgb_group.add_argument("--subsample", type=float, default=0.8)
    xgb_group.add_argument("--colsample-bytree", type=float, default=0.4)
    xgb_group.add_argument("--missing", type=float, default=-1.0)
    xgb_group.add_argument("--eval-metric", default="auc")
    xgb_group.add_argument("--tree-method", default="hist")
    xgb_group.add_argument("--device", default="cpu", help="XGBoost device, e.g. cpu or cuda")
    xgb_group.add_argument("--early-stopping-rounds", type=int, default=100)
    xgb_group.add_argument("--verbose", type=int, default=50)

    output = parser.add_argument_group("output")
    output.add_argument(
        "--output-dir",
        type=Path,
        default=None,
        help=(
            "Artifact directory (default: AIP_MODEL_DIR, "
            "GCS_ARTIFACTS_BUCKET/models/xgb95, or ./models)"
        ),
    )
    output.add_argument(
        "--model-version",
        default=os.environ.get("MODEL_VERSION", "v1"),
        help="Version tag stored in xgb95_metadata.json",
    )
    output.add_argument(
        "--model-tag",
        default=os.environ.get("MODEL_TAG", ""),
        help="Optional deployment tag (e.g. xgb95, prod)",
    )

    return parser.parse_args()


def validate_args(args: argparse.Namespace) -> None:
    for path, label in (
        (args.train_transaction, "--train-transaction"),
        (args.train_identity, "--train-identity"),
    ):
        if not path.exists():
            raise FileNotFoundError(f"{label} not found: {path}")

    if not 0.0 < args.valid_fraction < 1.0:
        raise ValueError("--valid-fraction must be between 0 and 1")


def train_valid_indices(
    df: pd.DataFrame,
    valid_fraction: float,
    method: str,
) -> tuple[pd.Index, pd.Index]:
    n_valid = max(1, int(len(df) * valid_fraction))

    if method == "temporal":
        if "TransactionDT" not in df.columns:
            raise ValueError("TransactionDT required for temporal split")
        ordered = df.sort_values("TransactionDT")
        idx_valid = ordered.index[-n_valid:]
        idx_train = ordered.index[:-n_valid]
    else:
        idx_train = df.index[:-n_valid]
        idx_valid = df.index[-n_valid:]

    if len(idx_train) == 0:
        raise ValueError("valid_fraction too large; no rows left for training")
    return idx_train, idx_valid


def optimize_dtypes(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for col in out.columns:
        if out[col].dtype == np.float64:
            out[col] = out[col].astype(np.float32)
        elif out[col].dtype == np.int64:
            out[col] = out[col].astype(np.int32)
    return out


def build_classifier(args: argparse.Namespace, *, early_stopping: int | None) -> xgb.XGBClassifier:
    params: dict = {
        "n_estimators": args.n_estimators,
        "max_depth": args.max_depth,
        "learning_rate": args.learning_rate,
        "subsample": args.subsample,
        "colsample_bytree": args.colsample_bytree,
        "missing": args.missing,
        "eval_metric": args.eval_metric,
        "tree_method": args.tree_method,
        "device": args.device,
    }
    if early_stopping is not None:
        params["early_stopping_rounds"] = early_stopping
    return xgb.XGBClassifier(**params)


def write_json(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload, indent=2) + "\n")


def train_and_export(args: argparse.Namespace) -> None:
    args = resolve_paths(args)
    validate_args(args)
    args.output_dir.mkdir(parents=True, exist_ok=True)

    x_train, y_train, _ = load_ieee_data(
        args.train_transaction,
        args.train_identity,
    )

    idx_train, idx_valid = train_valid_indices(x_train, args.valid_fraction, args.split_method)

    # FraudPreprocessor in shared/preprocess.py mirrors the Kaggle notebook pipeline
    # (join → D normalize → encode → cents/FE/CB/AG → feature drop), fit on train rows only.
    preprocessor = FraudPreprocessor()
    x_fit_raw = x_train.loc[idx_train]
    preprocessor.fit(x_fit_raw)

    save_training_stats(x_fit_raw, args.output_dir / "xgb95_train_stats.pkl")

    x_all = optimize_dtypes(preprocessor.transform(x_train))
    x_valid = optimize_dtypes(preprocessor.transform(x_train.loc[idx_valid]))
    feature_columns = preprocessor.feature_columns
    y_all = y_train.astype(np.int8)
    y_valid = y_train.loc[idx_valid].astype(np.int8)

    x_train_mat = x_all.loc[idx_train, feature_columns]
    x_valid_mat = x_valid[feature_columns]

    split_meta: dict = {
        "validation_split": args.split_method,
        "valid_fraction": args.valid_fraction,
        "train_rows": int(len(idx_train)),
        "valid_rows": int(len(idx_valid)),
    }
    if args.split_method == "temporal":
        split_meta["split_transaction_dt"] = {
            "train_max": float(x_train.loc[idx_train, "TransactionDT"].max()),
            "valid_min": float(x_train.loc[idx_valid, "TransactionDT"].min()),
        }

    eval_model = build_classifier(args, early_stopping=args.early_stopping_rounds)
    eval_model.fit(
        x_train_mat,
        y_all.loc[idx_train],
        eval_set=[(x_valid_mat, y_valid)],
        verbose=args.verbose,
    )

    valid_probs = eval_model.predict_proba(x_valid_mat)[:, 1]
    valid_auc = float(roc_auc_score(y_valid, valid_probs))
    best_iteration = int(getattr(eval_model, "best_iteration", args.n_estimators))

    if args.train_on_all:
        final_trees = best_iteration if args.early_stopping_rounds else args.n_estimators
        final_model = build_classifier(args, early_stopping=None)
        final_model.set_params(n_estimators=final_trees)
        final_model.fit(x_all[feature_columns], y_all, verbose=args.verbose)
        model = final_model
    else:
        model = eval_model

    model.save_model(args.output_dir / "xgb95.ubj")
    preprocessor.save(args.output_dir / "xgb95_encoders.pkl")
    joblib.dump(feature_columns, args.output_dir / "xgb95_features.pkl")

    write_json(
        args.output_dir / "xgb95_metadata.json",
        {
            "model_name": "xgboost_ieee_fraud",
            "version": args.model_version,
            "tag": args.model_tag or None,
            "auc": round(valid_auc, 4),
            "threshold": DEFAULT_THRESHOLDS["default"],
            "features": len(feature_columns),
            "trained_on": "IEEE-CIS Fraud Detection",
            "algorithm": "XGBoost",
            "best_iteration": best_iteration,
            "train_on_all": args.train_on_all,
            "hyperparameters": {
                "n_estimators": args.n_estimators,
                "learning_rate": args.learning_rate,
                "max_depth": args.max_depth,
                "subsample": args.subsample,
                "colsample_bytree": args.colsample_bytree,
                "missing": args.missing,
                "eval_metric": args.eval_metric,
                "tree_method": args.tree_method,
                "device": args.device,
                "early_stopping_rounds": args.early_stopping_rounds,
            },
            "data_paths": {
                "train_transaction": str(args.train_transaction),
                "train_identity": str(args.train_identity),
            },
            "output_dir": str(args.output_dir),
            **split_meta,
        },
    )
    write_json(args.output_dir / "xgb_threshold.json", DEFAULT_THRESHOLDS)

    print(f"Saved model artifacts to {args.output_dir}")
    for name in (
        "xgb95.ubj",
        "xgb95_encoders.pkl",
        "xgb95_features.pkl",
        "xgb95_train_stats.pkl",
        "xgb95_metadata.json",
        "xgb_threshold.json",
    ):
        print(f"  {name}")
    print(f"Split ({args.split_method}): {len(idx_train)} train / {len(idx_valid)} valid rows")
    print(f"Validation AUC: {valid_auc:.4f}  best_iteration: {best_iteration}")
    print(f"Final model train_on_all={args.train_on_all}  features={len(feature_columns)}")

    del model, eval_model, x_train, y_train, preprocessor, x_all, x_valid
    gc.collect()


if __name__ == "__main__":
    train_and_export(parse_args())
