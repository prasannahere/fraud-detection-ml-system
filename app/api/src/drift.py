"""App-level drift helpers bound to runtime artifact paths."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import pandas as pd

from shared.drift import check_drift as _check_drift
from shared.drift import compute_feature_drift as _compute_feature_drift
from shared.drift import save_training_stats as _save_training_stats
from src.config import resolve_training_stats_path


def _training_stats_path() -> Path:
    return resolve_training_stats_path()


def save_training_stats(df: pd.DataFrame, path: Path | None = None) -> None:
    _save_training_stats(df, path or _training_stats_path())


def check_drift(raw_df: pd.DataFrame, z_threshold: float = 3.0) -> dict[str, Any]:
    return _check_drift(raw_df, _training_stats_path(), z_threshold=z_threshold)


def compute_feature_drift(
    raw_df: pd.DataFrame,
    features_df: pd.DataFrame | None = None,
) -> dict[str, Any]:
    return _compute_feature_drift(raw_df, _training_stats_path(), features_df=features_df)
