"""IEEE-CIS fraud feature engineering for training and inference."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd

from src.constants import (
    AGG_MAIN_COLUMNS,
    AGGREGATIONS,
    AGG_UIDS,
    CAT_COLS,
    COMBINE_PAIRS,
    D_COLS_SKIP_NORMALIZE,
    FEATURES_TO_DROP,
    FREQ_ENCODE_COLS,
    FREQ_ENCODE_COMBINED_COLS,
    IDENTITY_RENAME_MAP,
    LOAD_COLS,
)


class FraudPreprocessor:
    """Fits and applies the notebook preprocessing pipeline."""

    def __init__(self) -> None:
        self.label_maps: dict[str, dict[Any, int]] = {}
        self.numeric_mins: dict[str, float] = {}
        self.frequency_maps: dict[str, dict[Any, float]] = {}
        self.aggregation_maps: dict[str, dict[Any, float]] = {}
        self.nunique_maps: dict[str, dict[Any, float]] = {}
        self.feature_columns: list[str] = []

    def fit(self, train_df: pd.DataFrame, test_df: pd.DataFrame | None = None) -> "FraudPreprocessor":
        train = train_df.copy()
        test = test_df.copy() if test_df is not None else pd.DataFrame(index=train.index)

        train = normalize_d_columns(train)
        test = normalize_d_columns(test)

        self._fit_base_encoding(train, test)

        train, test = self._apply_feature_engineering(train, test, fit=True)
        self.feature_columns = select_model_features(train)

        return self

    def transform(self, df: pd.DataFrame) -> pd.DataFrame:
        if not self.feature_columns:
            raise ValueError("Preprocessor is not fitted. Load encoders or call fit() first.")

        out = df.copy()
        out = normalize_d_columns(out)
        out = self._apply_base_encoding(out)
        out, _ = self._apply_feature_engineering(out, pd.DataFrame(), fit=False)
        return align_columns(out, self.feature_columns)

    def save(self, path: str | Path) -> None:
        joblib.dump(
            {
                "label_maps": self.label_maps,
                "numeric_mins": self.numeric_mins,
                "frequency_maps": self.frequency_maps,
                "aggregation_maps": self.aggregation_maps,
                "nunique_maps": self.nunique_maps,
                "feature_columns": self.feature_columns,
            },
            path,
        )

    @classmethod
    def load(cls, path: str | Path) -> "FraudPreprocessor":
        payload = joblib.load(path)
        preprocessor = cls()
        preprocessor.label_maps = payload["label_maps"]
        preprocessor.numeric_mins = payload["numeric_mins"]
        preprocessor.frequency_maps = payload["frequency_maps"]
        preprocessor.aggregation_maps = payload["aggregation_maps"]
        preprocessor.nunique_maps = payload.get("nunique_maps", {})
        preprocessor.feature_columns = payload["feature_columns"]
        return preprocessor


def normalize_identity_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    rename = {col: target for col, target in IDENTITY_RENAME_MAP.items() if col in out.columns}
    if rename:
        out = out.rename(columns=rename)
    return out


def normalize_d_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    if "TransactionDT" not in out.columns:
        return out

    seconds_per_day = np.float32(24 * 60 * 60)
    dt = out["TransactionDT"].astype(np.float32)

    for i in range(1, 16):
        if i in D_COLS_SKIP_NORMALIZE:
            continue
        col = f"D{i}"
        if col in out.columns:
            out[col] = out[col].astype(np.float32) - dt / seconds_per_day

    return out


def select_model_features(df: pd.DataFrame) -> list[str]:
    cols = list(df.columns)
    for col in FEATURES_TO_DROP:
        if col in cols:
            cols.remove(col)
    return cols


def align_columns(df: pd.DataFrame, feature_columns: list[str]) -> pd.DataFrame:
    aligned = df.reindex(columns=feature_columns, fill_value=-1)
    return aligned.astype(np.float32)


def _fit_label_map(train_series: pd.Series, test_series: pd.Series) -> dict[Any, int]:
    combined = pd.concat([train_series, test_series], axis=0)
    _, uniques = pd.factorize(combined, sort=True)
    return {value: int(code) for code, value in enumerate(uniques)}


def _apply_label_map(series: pd.Series, mapping: dict[Any, int]) -> pd.Series:
    unknown_code = max(mapping.values(), default=-1) + 1
    mapped = series.map(mapping)
    return mapped.fillna(unknown_code).astype(np.int32)


def _fit_frequency_map(train_series: pd.Series, test_series: pd.Series) -> dict[Any, float]:
    combined = pd.concat([train_series, test_series], axis=0)
    return combined.value_counts(dropna=True, normalize=True).to_dict()


def _apply_frequency_map(series: pd.Series, mapping: dict[Any, float]) -> pd.Series:
    return series.map(mapping).astype(np.float32)


def _fit_aggregation_map(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    main_col: str,
    uid: str,
    agg: str,
) -> dict[Any, float]:
    combined = pd.concat([train_df[[uid, main_col]], test_df[[uid, main_col]]], axis=0).copy()
    combined[main_col] = combined[main_col].replace(-1, np.nan)
    agg_map = combined.groupby(uid, dropna=False)[main_col].agg(agg)
    return agg_map.to_dict()


def _apply_aggregation_map(series: pd.Series, mapping: dict[Any, float]) -> pd.Series:
    return series.map(mapping).fillna(-1).astype(np.float32)


def _add_feature_frame(df: pd.DataFrame, features: dict[str, pd.Series]) -> pd.DataFrame:
    if not features:
        return df
    feature_df = pd.DataFrame(features, index=df.index)
    return pd.concat([df, feature_df], axis=1)


def _combine_columns(df: pd.DataFrame, col1: str, col2: str) -> pd.Series:
    return df[col1].astype("string") + "_" + df[col2].astype("string")


def preprocess(df: pd.DataFrame, encoders_path: str | Path = "model/encoders.pkl") -> pd.DataFrame:
    """Apply saved preprocessing to incoming transactions."""
    preprocessor = FraudPreprocessor.load(encoders_path)
    return preprocessor.transform(df)


# ---------------------------------------------------------------------------
# FraudPreprocessor helpers
# ---------------------------------------------------------------------------


def _fit_base_encoding(self: FraudPreprocessor, train_df: pd.DataFrame, test_df: pd.DataFrame) -> None:
    for col in train_df.columns:
        if train_df[col].dtype.name in {"category", "object"} or col in CAT_COLS:
            self.label_maps[col] = _fit_label_map(train_df[col], test_df[col] if col in test_df.columns else pd.Series(dtype=object))
        elif col not in {"TransactionDT", "TransactionAmt"}:
            train_min = train_df[col].min()
            test_min = test_df[col].min() if col in test_df.columns else train_min
            self.numeric_mins[col] = float(min(train_min, test_min))


def _apply_base_encoding(self: FraudPreprocessor, df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()

    for col in out.columns:
        if col in self.label_maps:
            out[col] = _apply_label_map(out[col], self.label_maps[col])
        elif col in self.numeric_mins:
            out[col] = out[col].astype(np.float32) - np.float32(self.numeric_mins[col])
            out[col] = out[col].fillna(-1)
        elif col not in {"TransactionDT", "TransactionAmt"} and pd.api.types.is_numeric_dtype(out[col]):
            out[col] = out[col].fillna(-1)

    return out


def _apply_feature_engineering(
    self: FraudPreprocessor,
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    fit: bool,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    train = train_df.copy()
    test = test_df.copy()

    train = _add_feature_frame(
        train,
        {
            "cents": (
                train["TransactionAmt"] - np.floor(train["TransactionAmt"])
            ).astype(np.float32)
        },
    )
    if len(test):
        test = _add_feature_frame(
            test,
            {
                "cents": (
                    test["TransactionAmt"] - np.floor(test["TransactionAmt"])
                ).astype(np.float32)
            },
        )

    train, test = _frequency_encode(self, train, test, FREQ_ENCODE_COLS, fit)

    for col1, col2 in COMBINE_PAIRS:
        combined_col = f"{col1}_{col2}"
        train = _add_feature_frame(train, {combined_col: _combine_columns(train, col1, col2)})
        if len(test):
            test = _add_feature_frame(test, {combined_col: _combine_columns(test, col1, col2)})

        if fit:
            self.label_maps[combined_col] = _fit_label_map(train[combined_col], test[combined_col] if len(test) else pd.Series(dtype=object))
        train[combined_col] = _apply_label_map(train[combined_col], self.label_maps[combined_col])
        if len(test):
            test[combined_col] = _apply_label_map(test[combined_col], self.label_maps[combined_col])

    train, test = _frequency_encode(self, train, test, FREQ_ENCODE_COMBINED_COLS, fit)
    train, test = _aggregate_features(self, train, test, fit)

    return train, test


def _frequency_encode(
    self: FraudPreprocessor,
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    cols: list[str],
    fit: bool,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    train = train_df.copy()
    test = test_df.copy()
    train_feats: dict[str, pd.Series] = {}
    test_feats: dict[str, pd.Series] = {}

    for col in cols:
        new_col = f"{col}_FE"
        if fit:
            self.frequency_maps[col] = _fit_frequency_map(
                train[col],
                test[col] if col in test.columns else pd.Series(dtype=object),
            )
        train_feats[new_col] = _apply_frequency_map(train[col], self.frequency_maps[col])
        if len(test):
            test_feats[new_col] = _apply_frequency_map(test[col], self.frequency_maps[col])

    train = _add_feature_frame(train, train_feats)
    if len(test):
        test = _add_feature_frame(test, test_feats)

    return train, test


def _aggregate_features(
    self: FraudPreprocessor,
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    fit: bool,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    train = train_df.copy()
    test = test_df.copy()
    train_feats: dict[str, pd.Series] = {}
    test_feats: dict[str, pd.Series] = {}

    for main_col in AGG_MAIN_COLUMNS:
        for uid in AGG_UIDS:
            for agg in AGGREGATIONS:
                new_col = f"{main_col}_{uid}_{agg}"
                if fit:
                    self.aggregation_maps[new_col] = _fit_aggregation_map(
                        train,
                        test if len(test) else pd.DataFrame(columns=train.columns),
                        main_col,
                        uid,
                        agg,
                    )
                train_feats[new_col] = _apply_aggregation_map(train[uid], self.aggregation_maps[new_col])
                if len(test):
                    test_feats[new_col] = _apply_aggregation_map(test[uid], self.aggregation_maps[new_col])

    train = _add_feature_frame(train, train_feats)
    if len(test):
        test = _add_feature_frame(test, test_feats)

    return train, test


FraudPreprocessor._fit_base_encoding = _fit_base_encoding
FraudPreprocessor._apply_base_encoding = _apply_base_encoding
FraudPreprocessor._apply_feature_engineering = _apply_feature_engineering


# Notebook-compatible function names (cells 17–18)
def encode_fe(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    cols: list[str],
    preprocessor: FraudPreprocessor | None = None,
    fit: bool = True,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    pre = preprocessor or FraudPreprocessor()
    return _frequency_encode(pre, train_df, test_df, cols, fit)


def encode_le(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    col: str,
    preprocessor: FraudPreprocessor | None = None,
    fit: bool = True,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    pre = preprocessor or FraudPreprocessor()
    train = train_df.copy()
    test = test_df.copy()
    if fit:
        pre.label_maps[col] = _fit_label_map(train[col], test[col] if col in test.columns else pd.Series(dtype=object))
    train[col] = _apply_label_map(train[col], pre.label_maps[col])
    if len(test):
        test[col] = _apply_label_map(test[col], pre.label_maps[col])
    return train, test


def encode_cb(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    col1: str,
    col2: str,
    preprocessor: FraudPreprocessor | None = None,
    fit: bool = True,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    pre = preprocessor or FraudPreprocessor()
    combined_col = f"{col1}_{col2}"
    train = _add_feature_frame(train_df, {combined_col: _combine_columns(train_df, col1, col2)})
    test = _add_feature_frame(test_df, {combined_col: _combine_columns(test_df, col1, col2)}) if len(test_df) else test_df
    return encode_le(train, test, combined_col, preprocessor=pre, fit=fit)


def encode_ag(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    main_columns: list[str] | None = None,
    uids: list[str] | None = None,
    aggregations: tuple[str, ...] = AGGREGATIONS,
    fillna: bool = True,
    usena: bool = True,
    preprocessor: FraudPreprocessor | None = None,
    fit: bool = True,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    pre = preprocessor or FraudPreprocessor()
    main_columns = main_columns or AGG_MAIN_COLUMNS
    uids = uids or AGG_UIDS
    train = train_df.copy()
    test = test_df.copy()
    train_feats: dict[str, pd.Series] = {}
    test_feats: dict[str, pd.Series] = {}

    for main_col in main_columns:
        for uid in uids:
            combined = pd.concat(
                [train[[uid, main_col]], test[[uid, main_col]] if len(test) else train[[uid, main_col]]],
                axis=0,
            ).copy()
            if usena:
                combined[main_col] = combined[main_col].replace(-1, np.nan)
            for agg in aggregations:
                new_col = f"{main_col}_{uid}_{agg}"
                if fit:
                    pre.aggregation_maps[new_col] = combined.groupby(uid, dropna=False)[main_col].agg(agg).to_dict()
                train_feats[new_col] = _apply_aggregation_map(train[uid], pre.aggregation_maps[new_col])
                if len(test):
                    test_feats[new_col] = _apply_aggregation_map(test[uid], pre.aggregation_maps[new_col])

    train = _add_feature_frame(train, train_feats)
    if len(test):
        test = _add_feature_frame(test, test_feats)
    return train, test


def encode_ag2(
    train_df: pd.DataFrame,
    test_df: pd.DataFrame,
    main_columns: list[str],
    uids: list[str],
    preprocessor: FraudPreprocessor | None = None,
    fit: bool = True,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    pre = preprocessor or FraudPreprocessor()
    if not hasattr(pre, "nunique_maps"):
        pre.nunique_maps = {}

    train = train_df.copy()
    test = test_df.copy()
    train_feats: dict[str, pd.Series] = {}
    test_feats: dict[str, pd.Series] = {}

    for main_col in main_columns:
        for uid in uids:
            new_col = f"{uid}_{main_col}_ct"
            combined = pd.concat(
                [train[[uid, main_col]], test[[uid, main_col]] if len(test) else train[[uid, main_col]]],
                axis=0,
            )
            if fit:
                pre.nunique_maps[new_col] = combined.groupby(uid, dropna=False)[main_col].nunique().to_dict()
            train_feats[new_col] = train[uid].map(pre.nunique_maps[new_col]).astype("float32")
            if len(test):
                test_feats[new_col] = test[uid].map(pre.nunique_maps[new_col]).astype("float32")

    train = _add_feature_frame(train, train_feats)
    if len(test):
        test = _add_feature_frame(test, test_feats)
    return train, test


def build_dtypes() -> dict[str, str]:
    dtypes: dict[str, str] = {}
    id_cols = (
        [f"id_0{i}" for i in range(1, 10)]
        + [f"id-0{i}" for i in range(1, 10)]
        + [f"id_{i}" for i in range(10, 34)]
        + [f"id-{i}" for i in range(10, 34)]
    )
    for col in LOAD_COLS + id_cols:
        dtypes[col] = "float32"
    for col in CAT_COLS:
        dtypes[col] = "category"
    return dtypes


def load_ieee_data(
    train_transaction_path: str | Path,
    train_identity_path: str | Path | None = None,
    test_transaction_path: str | Path | None = None,
    test_identity_path: str | Path | None = None,
) -> tuple[pd.DataFrame, pd.Series | None, pd.DataFrame | None]:
    dtypes = build_dtypes()

    train = pd.read_csv(
        train_transaction_path,
        dtype=dtypes,
        usecols=LOAD_COLS + ["isFraud"],
        index_col="TransactionID",
    )

    y_train = train.pop("isFraud")

    if train_identity_path:
        identity = pd.read_csv(train_identity_path, dtype=dtypes, index_col="TransactionID")
        train = train.merge(identity, how="left", left_index=True, right_index=True)
    else:
        identity = None

    test = None
    if test_transaction_path:
        test = pd.read_csv(
            test_transaction_path,
            dtype=dtypes,
            usecols=LOAD_COLS,
            index_col="TransactionID",
        )
        if test_identity_path and identity is not None:
            test_identity = pd.read_csv(test_identity_path, dtype=dtypes, index_col="TransactionID")
            rename_map = {src: dst for src, dst in zip(test_identity.columns, identity.columns)}
            test_identity = test_identity.rename(columns=rename_map)
            test = test.merge(test_identity, how="left", left_index=True, right_index=True)

    return train, y_train, test
