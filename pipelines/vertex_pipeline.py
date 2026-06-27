"""Vertex AI pipeline orchestration for fraud detection."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

DEFAULT_TRAINING_IMAGE = os.getenv(
    "TRAINING_IMAGE",
    "us-central1-docker.pkg.dev/fraud-detection-500117/fraud-detection-repo/training:latest",
)
GCS_ARTIFACTS_BUCKET = os.getenv("GCS_ARTIFACTS_BUCKET", "fraud-detection-500117-artifacts")
GCS_DATA_PREFIX = os.getenv("GCS_DATA_PREFIX", "data")
OUTPUT_PREFIX = os.getenv("OUTPUT_PREFIX", "models/xgb95")
GCS_FUSE_ROOT = f"/gcs/{GCS_ARTIFACTS_BUCKET}"
GCS_DATA_ROOT = f"{GCS_FUSE_ROOT}/{GCS_DATA_PREFIX}"
OUTPUT_FUSE_ROOT = f"{GCS_FUSE_ROOT}/{OUTPUT_PREFIX}"


def compile_pipeline(output_path: Path | None = None) -> Path:
    """Compile the training pipeline definition for Vertex AI."""
    target = output_path or ROOT / "pipelines" / "compiled" / "train_pipeline.json"
    target.parent.mkdir(parents=True, exist_ok=True)

    pipeline_spec = {
        "display_name": "fraud-detection-train",
        "description": "Train XGBoost fraud model and write artifacts to GCS via FUSE",
        "components": [
            {
                "name": "train-model",
                "image": DEFAULT_TRAINING_IMAGE,
                "command": [
                    "python",
                    "training/xgb_train.py",
                    "--train-transaction",
                    f"{GCS_DATA_ROOT}/train_transaction.csv",
                    "--train-identity",
                    f"{GCS_DATA_ROOT}/train_identity.csv",
                    "--output-dir",
                    OUTPUT_FUSE_ROOT,
                    "--split-method",
                    "temporal",
                    "--model-version",
                    "v1",
                    "--model-tag",
                    "xgb95",
                ],
                "environment": {
                    "GCS_ARTIFACTS_BUCKET": GCS_ARTIFACTS_BUCKET,
                    "GCS_DATA_PREFIX": GCS_DATA_PREFIX,
                    "OUTPUT_PREFIX": OUTPUT_PREFIX,
                },
            },
        ],
    }

    target.write_text(json.dumps(pipeline_spec, indent=2))
    return target


def main() -> None:
    parser = argparse.ArgumentParser(description="Compile Vertex AI pipeline spec")
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "pipelines" / "compiled" / "train_pipeline.json",
    )
    args = parser.parse_args()
    path = compile_pipeline(args.output)
    print(f"Wrote pipeline spec to {path}")


if __name__ == "__main__":
    main()
