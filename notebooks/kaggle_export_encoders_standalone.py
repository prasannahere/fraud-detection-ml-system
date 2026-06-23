# =============================================================================
# KAGGLE-ONLY CELL — paste into kaggle-ieee-cis-prasannahere.ipynb
# Run AFTER the model-save cell (after xgb95_final.ubj is written).
#
# Uses variables already defined in upper notebook cells — no hardcoded column
# lists.  `cols` (cell 25) becomes encoders.pkl feature_columns exactly.
#
# Requires from earlier cells:
#   cols, cat_cols, dtypes, MODEL_DIR, X_train, Y_train
#   train_transaction_v_cols_only, train_transaction_cols_excl_v, num_cols
#   os, gc, joblib, pandas, numpy (imported in cell 1)
# =============================================================================

import gc
import os
import joblib
import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Guard — fail fast if upstream cells were not run
# ---------------------------------------------------------------------------
_REQUIRED = (
    "cols",
    "cat_cols",
    "dtypes",
    "MODEL_DIR",
    "X_train",
    "train_transaction_cols_excl_v",
    "num_cols",
)
_missing = [name for name in _REQUIRED if name not in globals()]
if _missing:
    raise RuntimeError(
        "Run upstream cells first; missing globals: " + ", ".join(_missing)
    )

# load-time column list from cells 3–4 / 7 (NOT the model-feature `cols` above)
if "train_transaction_v_cols_only" not in globals():
    train_transaction_v_cols_only = []

_load_cols = train_transaction_v_cols_only + train_transaction_cols_excl_v + num_cols
_seen = set()
LOAD_COLS = [c for c in _load_cols if not (c in _seen or _seen.add(c))]

_MODEL_FEATURES = list(cols)  # cell 25 — frozen before any export mutation
D_COLS_SKIP = {1, 2, 3, 5, 9}

IEEE_TRAIN_TXN = "/kaggle/input/competitions/ieee-fraud-detection/train_transaction.csv"
IEEE_TRAIN_ID = "/kaggle/input/competitions/ieee-fraud-detection/train_identity.csv"
IEEE_TEST_TXN = "/kaggle/input/competitions/ieee-fraud-detection/test_transaction.csv"
IEEE_TEST_ID = "/kaggle/input/competitions/ieee-fraud-detection/test_identity.csv"


# ---------------------------------------------------------------------------
# Preprocessor — mirrors fraud-api/src/preprocess.py save format
# ---------------------------------------------------------------------------
class FraudPreprocessor:
    def __init__(self):
        self.label_maps = {}
        self.numeric_mins = {}
        self.frequency_maps = {}
        self.aggregation_maps = {}
        self.nunique_maps = {}
        self.feature_columns = []

    def save(self, path):
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


def _normalize_d_columns(df):
    """Cell 14 — same D* shift relative to TransactionDT."""
    out = df.copy()
    if "TransactionDT" not in out.columns:
        return out
    seconds = np.float32(24 * 60 * 60)
    dt = out["TransactionDT"].astype(np.float32)
    for i in range(1, 16):
        if i in D_COLS_SKIP:
            continue
        col = f"D{i}"
        if col in out.columns:
            out[col] = out[col].astype(np.float32) - dt / seconds
    return out


def _fit_base_encoding(pre, train_df, test_df):
    """Cell 17 — label-encode categoricals, subtract numeric mins."""
    for col in train_df.columns:
        if train_df[col].dtype.name in ("category", "object") or col in cat_cols:
            combined = pd.concat([train_df[col], test_df[col]], axis=0)
            _, uniques = pd.factorize(combined, sort=True)
            pre.label_maps[col] = {v: int(i) for i, v in enumerate(uniques)}
        elif col not in ("TransactionDT", "TransactionAmt"):
            pre.numeric_mins[col] = float(
                min(train_df[col].min(), test_df[col].min())
            )


def _add_feature_frames(train_df, test_df, train_feats, test_feats):
    if train_feats:
        train_df = pd.concat(
            [train_df, pd.DataFrame(train_feats, index=train_df.index)],
            axis=1,
        )
    if test_feats:
        test_df = pd.concat(
            [test_df, pd.DataFrame(test_feats, index=test_df.index)],
            axis=1,
        )
    return train_df.copy(), test_df.copy()


def _capture_encode_fe(pre, train_df, test_df, fe_cols):
    """Cell 19 encode_fe — store frequency_maps."""
    train_feats, test_feats = {}, {}
    for col in fe_cols:
        combined = pd.concat([train_df[col], test_df[col]], axis=0)
        pre.frequency_maps[col] = combined.value_counts(
            dropna=True, normalize=True
        ).to_dict()
        new_col = f"{col}_FE"
        train_feats[new_col] = (
            train_df[col].map(pre.frequency_maps[col]).astype("float32")
        )
        test_feats[new_col] = (
            test_df[col].map(pre.frequency_maps[col]).astype("float32")
        )
    return _add_feature_frames(train_df, test_df, train_feats, test_feats)


def _capture_encode_cb(pre, train_df, test_df, col1, col2):
    """Cell 19 encode_cb — store combined label_map."""
    new_col = f"{col1}_{col2}"
    train_feats = {
        new_col: train_df[col1].astype("string") + "_" + train_df[col2].astype("string")
    }
    test_feats = {
        new_col: test_df[col1].astype("string") + "_" + test_df[col2].astype("string")
    }
    train_df, test_df = _add_feature_frames(train_df, test_df, train_feats, test_feats)

    combined = pd.concat([train_df[new_col], test_df[new_col]], axis=0)
    _, uniques = pd.factorize(combined, sort=True)
    pre.label_maps[new_col] = {v: int(i) for i, v in enumerate(uniques)}
    return train_df, test_df


def _capture_encode_ag(pre, train_df, test_df, main_columns, uids, aggregations):
    """Cell 19 encode_ag (usena=True) — store aggregation_maps."""
    train_feats, test_feats = {}, {}
    for main_col in main_columns:
        for uid in uids:
            combined = pd.concat(
                [train_df[[uid, main_col]], test_df[[uid, main_col]]],
                axis=0,
            ).copy()
            combined[main_col] = combined[main_col].replace(-1, np.nan)
            for agg in aggregations:
                new_col = f"{main_col}_{uid}_{agg}"
                pre.aggregation_maps[new_col] = (
                    combined.groupby(uid, dropna=False)[main_col]
                    .agg(agg)
                    .to_dict()
                )
                train_feats[new_col] = (
                    train_df[uid]
                    .map(pre.aggregation_maps[new_col])
                    .astype("float32")
                    .fillna(-1)
                )
                test_feats[new_col] = (
                    test_df[uid]
                    .map(pre.aggregation_maps[new_col])
                    .astype("float32")
                    .fillna(-1)
                )
    return _add_feature_frames(train_df, test_df, train_feats, test_feats)


def _apply_feature_engineering(pre, train_df, test_df):
    """Cell 22 — identical FE chain, capturing all maps."""
    train, test = train_df.copy(), test_df.copy()

    train, test = _add_feature_frames(
        train,
        test,
        {
            "cents": (
                train["TransactionAmt"] - np.floor(train["TransactionAmt"])
            ).astype("float32")
        },
        {
            "cents": (
                test["TransactionAmt"] - np.floor(test["TransactionAmt"])
            ).astype("float32")
        },
    )

    train, test = _capture_encode_fe(
        pre, train, test, ["addr1", "card1", "card2", "card3", "P_emaildomain"]
    )
    train, test = _capture_encode_cb(pre, train, test, "card1", "addr1")
    train, test = _capture_encode_cb(pre, train, test, "card1_addr1", "P_emaildomain")
    train, test = _capture_encode_fe(
        pre, train, test, ["card1_addr1", "card1_addr1_P_emaildomain"]
    )
    train, test = _capture_encode_ag(
        pre,
        train,
        test,
        main_columns=["TransactionAmt", "D9", "D11"],
        uids=["card1", "card1_addr1", "card1_addr1_P_emaildomain"],
        aggregations=("mean", "std"),
    )
    return train, test


def load_ieee_raw():
    """Cell 10 reload — uses notebook dtypes + LOAD_COLS built from upper cells."""
    train = pd.read_csv(
        IEEE_TRAIN_TXN,
        dtype=dtypes,
        usecols=LOAD_COLS + ["isFraud"],
        index_col="TransactionID",
    )
    train.pop("isFraud")
    identity = pd.read_csv(IEEE_TRAIN_ID, dtype=dtypes, index_col="TransactionID")
    train = train.merge(identity, how="left", left_index=True, right_index=True)

    test = pd.read_csv(
        IEEE_TEST_TXN,
        dtype=dtypes,
        usecols=LOAD_COLS,
        index_col="TransactionID",
    )
    test_identity = pd.read_csv(IEEE_TEST_ID, dtype=dtypes, index_col="TransactionID")
    rename_map = {src: dst for src, dst in zip(test_identity.columns, identity.columns)}
    test = test.merge(
        test_identity.rename(columns=rename_map),
        how="left",
        left_index=True,
        right_index=True,
    )
    return train, test


def save_training_stats(df, path):
    numeric = df.select_dtypes(include=[np.number])
    stats = {
        col: {
            "mean": float(numeric[col].mean()),
            "std": float(numeric[col].std() or 1.0),
            "p05": float(numeric[col].quantile(0.05)),
            "p95": float(numeric[col].quantile(0.95)),
        }
        for col in numeric.columns
    }
    joblib.dump(stats, path)


def fit_preprocessor_from_notebook_pipeline():
    """Replay cells 14 → 17 → 22 on a fresh raw reload; feature list = cell 25 cols."""
    pre = FraudPreprocessor()

    print("Reloading raw IEEE data (load cols:", len(LOAD_COLS), ")...")
    train_raw, test_raw = load_ieee_raw()

    train_raw = _normalize_d_columns(train_raw)
    test_raw = _normalize_d_columns(test_raw)

    print("Fitting base encoders (cell 17)...")
    _fit_base_encoding(pre, train_raw, test_raw)

    print("Fitting feature engineering maps (cell 22)...")
    train_fe, test_fe = _apply_feature_engineering(pre, train_raw, test_raw)

    pre.feature_columns = list(_MODEL_FEATURES)

    missing = set(pre.feature_columns) - set(train_fe.columns)
    if missing:
        raise ValueError(
            f"{len(missing)} model features missing after FE replay: "
            f"{sorted(missing)[:15]}{'...' if len(missing) > 15 else ''}"
        )

    del train_raw, test_raw, train_fe, test_fe
    gc.collect()
    return pre


# ---------------------------------------------------------------------------
# Run export
# ---------------------------------------------------------------------------
os.makedirs(MODEL_DIR, exist_ok=True)

preprocessor = fit_preprocessor_from_notebook_pipeline()

encoders_path = os.path.join(MODEL_DIR, "encoders.pkl")
stats_path = os.path.join(MODEL_DIR, "training_stats.pkl")

preprocessor.save(encoders_path)
save_training_stats(X_train[_MODEL_FEATURES], stats_path)

print("ENCODERS       :", encoders_path)
print("TRAINING_STATS :", stats_path)
print("Feature count  :", len(preprocessor.feature_columns))

if len(_MODEL_FEATURES) != len(preprocessor.feature_columns):
    raise RuntimeError(
        f"Internal mismatch: _MODEL_FEATURES={len(_MODEL_FEATURES)} "
        f"vs feature_columns={len(preprocessor.feature_columns)}"
    )

if list(preprocessor.feature_columns) != list(_MODEL_FEATURES):
    raise RuntimeError("feature_columns order/content differs from notebook `cols`")

# Cross-check against the in-memory training matrix the model actually saw
_notebook_missing = set(_MODEL_FEATURES) - set(X_train.columns)
if _notebook_missing:
    raise RuntimeError(
        f"Notebook X_train missing {len(_notebook_missing)} cols: "
        f"{sorted(_notebook_missing)[:10]}"
    )

print("OK:", len(_MODEL_FEATURES), "features — matches notebook `cols` exactly")

del preprocessor
gc.collect()
print("Done — download encoders.pkl + training_stats.pkl from Output")
