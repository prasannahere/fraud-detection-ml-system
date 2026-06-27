"""Tests for shared drift utilities."""

from pathlib import Path

import pandas as pd

from shared.drift import check_drift, save_training_stats


def test_save_and_check_drift(tmp_path: Path) -> None:
    stats_path = tmp_path / "training_stats.pkl"
    df = pd.DataFrame({"TransactionAmt": [100.0, 200.0, 150.0]})

    save_training_stats(df, stats_path)

    result = check_drift(pd.DataFrame({"TransactionAmt": [1000.0]}), stats_path)
    assert result["drift_detected"] is True
    assert result["columns"][0]["column"] == "TransactionAmt"


def test_check_drift_without_stats(tmp_path: Path) -> None:
    result = check_drift(pd.DataFrame({"TransactionAmt": [100.0]}), tmp_path / "missing.pkl")
    assert result["drift_detected"] is False
    assert "skipped" in result["message"]
