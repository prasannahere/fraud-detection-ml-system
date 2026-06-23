"""Train XGBoost on IEEE-CIS data and export deployment artifacts."""

from __future__ import annotations

import argparse
import gc
import sys
from pathlib import Path

import joblib
import numpy as np
import xgboost as xgb

ROOT = Path(__file__).resolve().parents[2]
FRAUD_API_DIR = ROOT / "fraud-api"
sys.path.insert(0, str(FRAUD_API_DIR))

from src.drift import save_training_stats
from src.preprocess import FraudPreprocessor, load_ieee_data  # noqa: E402


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train fraud model and export API artifacts")
    parser.add_argument(
        "--train-transaction",
        type=Path,
        default=ROOT / "data" / "train_transaction.csv",
    )
    parser.add_argument(
        "--train-identity",
        type=Path,
        default=ROOT / "data" / "train_identity.csv",
    )
    parser.add_argument(
        "--test-transaction",
        type=Path,
        default=ROOT / "data" / "test_transaction.csv",
    )
    parser.add_argument(
        "--test-identity",
        type=Path,
        default=ROOT / "data" / "test_identity.csv",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=FRAUD_API_DIR / "model",
    )
    parser.add_argument("--n-estimators", type=int, default=2000)
    parser.add_argument("--learning-rate", type=float, default=0.02)
    parser.add_argument("--max-depth", type=int, default=12)
    return parser.parse_args()


def optimize_dtypes(df):
    out = df.copy()
    for col in out.columns:
        if out[col].dtype == np.float64:
            out[col] = out[col].astype(np.float32)
        elif out[col].dtype == np.int64:
            out[col] = out[col].astype(np.int32)
    return out


def train_and_export(args: argparse.Namespace) -> None:
    args.output_dir.mkdir(parents=True, exist_ok=True)

    x_train, y_train, x_test = load_ieee_data(
        args.train_transaction,
        args.train_identity,
        args.test_transaction,
        args.test_identity,
    )

    preprocessor = FraudPreprocessor()
    preprocessor.fit(x_train, x_test)
    save_training_stats(x_train, args.output_dir / "training_stats.pkl")

    x_train = preprocessor.transform(x_train)
    feature_columns = preprocessor.feature_columns

    x_train = optimize_dtypes(x_train)
    y_train = y_train.astype(np.int8)

    idx_split = 3 * len(x_train) // 4
    idx_train = x_train.index[:idx_split]
    idx_valid = x_train.index[idx_split:]

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
        x_train.loc[idx_train, feature_columns],
        y_train.loc[idx_train],
        eval_set=[(x_train.loc[idx_valid, feature_columns], y_train.loc[idx_valid])],
        verbose=50,
    )

    model.save_model(args.output_dir / "xgb95_final.ubj")
    preprocessor.save(args.output_dir / "encoders.pkl")
    joblib.dump(feature_columns, args.output_dir / "xgb95_final_features.pkl")

    print(f"Saved model artifacts to {args.output_dir}")
    print("  xgb95_final.ubj")
    print("  encoders.pkl")
    print("  xgb95_final_features.pkl")
    print("  training_stats.pkl")
    print(f"Feature count: {len(feature_columns)}")

    del model, x_train, y_train, x_test, preprocessor
    gc.collect()


if __name__ == "__main__":
    train_and_export(parse_args())
