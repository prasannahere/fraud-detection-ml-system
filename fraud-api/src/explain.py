"""XGBoost tree contribution explanations."""

from __future__ import annotations

from typing import Any

import pandas as pd
import xgboost as xgb


def explain_prediction(
    model,
    features: pd.DataFrame,
    feature_columns: list[str],
    top_k: int = 10,
) -> dict[str, list[dict[str, Any]]]:
    matrix = features[feature_columns].to_numpy(dtype="float32")
    dmatrix = xgb.DMatrix(matrix, feature_names=feature_columns)
    contribs = model.get_booster().predict(dmatrix, pred_contribs=True)
    contributions = contribs[0][:-1]

    pairs = list(zip(feature_columns, contributions.tolist()))
    ranked = sorted(pairs, key=lambda item: abs(item[1]), reverse=True)

    def _serialize(items: list[tuple[str, float]]) -> list[dict[str, Any]]:
        return [{"feature": name, "shap_value": round(value, 6)} for name, value in items]

    positive = sorted((p for p in pairs if p[1] > 0), key=lambda item: item[1], reverse=True)[:top_k]
    negative = sorted((p for p in pairs if p[1] < 0), key=lambda item: item[1])[:top_k]

    return {
        "top_features": _serialize(ranked[:top_k]),
        "positive_contributors": _serialize(positive),
        "negative_contributors": _serialize(negative),
    }
