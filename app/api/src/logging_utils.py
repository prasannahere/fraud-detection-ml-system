"""Structured request logging for Cloud Logging."""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Any, Iterator

logger = logging.getLogger("fraud_api")


def configure_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format='{"severity":"%(levelname)s","message":"%(message)s","logger":"%(name)s"}',
    )


@contextmanager
def log_prediction_request(endpoint: str, extra: dict[str, Any] | None = None) -> Iterator[dict[str, Any]]:
    started = time.perf_counter()
    context: dict[str, Any] = {"endpoint": endpoint, **(extra or {})}
    try:
        yield context
    finally:
        context["latency_ms"] = round((time.perf_counter() - started) * 1000, 2)
        logger.info("prediction_request %s", context)
