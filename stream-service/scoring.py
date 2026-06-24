"""Server-side fraud scoring via fraud-api."""

from __future__ import annotations

import logging
import os
import time
from typing import Any

import httpx

logger = logging.getLogger("stream_service.scoring")

FRAUD_API_URL = os.getenv("FRAUD_API_URL", "").rstrip("/")
FRAUD_AUTH_USERNAME = os.getenv("FRAUD_AUTH_USERNAME", "admin")
FRAUD_AUTH_PASSWORD = os.getenv("FRAUD_AUTH_PASSWORD", "admin")
FRAUD_THRESHOLD = float(os.getenv("FRAUD_THRESHOLD", "0.8"))

_client: httpx.AsyncClient | None = None
_token = ""
_token_expires_at = 0.0


def scoring_enabled() -> bool:
    return bool(FRAUD_API_URL)


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0))
    return _client


async def close_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


async def _ensure_token() -> str:
    global _token, _token_expires_at

    if _token and time.time() < _token_expires_at - 60:
        return _token

    client = _get_client()
    resp = await client.post(
        f"{FRAUD_API_URL}/auth/login",
        json={"username": FRAUD_AUTH_USERNAME, "password": FRAUD_AUTH_PASSWORD},
    )
    resp.raise_for_status()
    payload = resp.json()
    _token = payload["access_token"]
    _token_expires_at = time.time() + float(payload.get("expires_in", 3600))
    return _token


async def score_transaction(row: dict[str, Any]) -> dict[str, Any] | None:
    """Score a transaction via fraud-api. Returns None if scoring is disabled or fails."""
    if not scoring_enabled():
        return None

    try:
        token = await _ensure_token()
        client = _get_client()
        resp = await client.post(
            f"{FRAUD_API_URL}/predict?threshold={FRAUD_THRESHOLD}",
            json=row,
            headers={"Authorization": f"Bearer {token}"},
        )
        if resp.status_code == 401:
            global _token_expires_at
            _token_expires_at = 0
            token = await _ensure_token()
            resp = await client.post(
                f"{FRAUD_API_URL}/predict?threshold={FRAUD_THRESHOLD}",
                json=row,
                headers={"Authorization": f"Bearer {token}"},
            )
        resp.raise_for_status()
        result = resp.json()
        return {
            "scored": True,
            "transaction": row,
            "fraud_probability": result["fraud_probability"],
            "decision": result.get("decision"),
            "threshold_used": result.get("threshold_used", FRAUD_THRESHOLD),
        }
    except Exception as exc:
        logger.warning("Server-side scoring failed: %s", exc)
        return None
