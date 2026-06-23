"""Optional BigQuery audit logging for predictions."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from src.config import (
    BIGQUERY_DATASET,
    BIGQUERY_TABLE,
    ENABLE_AUDIT,
    GCP_PROJECT,
    MODEL_VERSION,
)

logger = logging.getLogger("fraud_api.audit")


def write_prediction_audit(record: dict[str, Any]) -> None:
    if not ENABLE_AUDIT:
        return

    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "model_version": MODEL_VERSION,
        **record,
    }

    try:
        from google.cloud import bigquery

        if not GCP_PROJECT:
            logger.warning("ENABLE_AUDIT=true but GCP_PROJECT is unset; skipping audit write")
            return

        client = bigquery.Client(project=GCP_PROJECT)
        table_id = f"{GCP_PROJECT}.{BIGQUERY_DATASET}.{BIGQUERY_TABLE}"
        errors = client.insert_rows_json(table_id, [payload])
        if errors:
            logger.error("BigQuery audit insert failed: %s", errors)
    except ImportError:
        logger.warning("google-cloud-bigquery not installed; audit record skipped")
    except Exception as exc:
        logger.exception("Failed to write audit record: %s", exc)
