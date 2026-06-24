"""Lightweight transaction streaming service for live dashboard demos."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from threading import Lock
from typing import Any

import pandas as pd
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from scoring import close_client, score_transaction, scoring_enabled

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

DATA_FILE_PATH = os.getenv("DATA_FILE_PATH", "/data/sample_transactions.csv")
STREAM_INTERVAL_SECONDS = float(os.getenv("STREAM_INTERVAL_SECONDS", "1"))

app = FastAPI(title="Transaction Stream Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_df: pd.DataFrame | None = None
_index = 0
_lock = Lock()


def _load_dataset() -> pd.DataFrame:
    path = Path(DATA_FILE_PATH)
    if not path.exists():
        raise FileNotFoundError(f"DATA_FILE_PATH not found: {path}")

    if path.suffix.lower() == ".parquet":
        df = pd.read_parquet(path)
    elif path.suffix.lower() == ".csv":
        df = pd.read_csv(path)
    else:
        raise ValueError("Supported file types: .csv, .parquet")

    if df.empty:
        raise ValueError("Dataset is empty")

    return df


def _row_to_json(row: pd.Series) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    for col, value in row.items():
        if pd.isna(value):
            continue
        if isinstance(value, (pd.Timestamp,)):
            payload[col] = value.isoformat()
        elif hasattr(value, "item"):
            try:
                payload[col] = value.item()
            except (ValueError, AttributeError):
                payload[col] = str(value)
        else:
            payload[col] = value
    return payload


def get_next_row() -> dict[str, Any]:
    global _index

    if _df is None or _df.empty:
        raise HTTPException(status_code=503, detail="Dataset not loaded")

    with _lock:
        row = _df.iloc[_index]
        _index = (_index + 1) % len(_df)

    return _row_to_json(row)


@app.on_event("startup")
def startup() -> None:
    global _df
    _df = _load_dataset()


@app.on_event("shutdown")
async def shutdown() -> None:
    await close_client()


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "rows": 0 if _df is None else len(_df),
        "data_file": DATA_FILE_PATH,
        "server_side_scoring": scoring_enabled(),
    }


@app.get("/schema")
def schema() -> dict[str, Any]:
    if _df is None:
        raise HTTPException(status_code=503, detail="Dataset not loaded")

    columns = [
        {"name": col, "dtype": str(_df[col].dtype)}
        for col in _df.columns
    ]
    return {"columns": columns, "row_count": len(_df)}


@app.get("/next-row")
def next_row() -> dict[str, Any]:
    return get_next_row()


@app.get("/batch")
def batch_rows(limit: int = 30) -> dict[str, Any]:
    if _df is None:
        raise HTTPException(status_code=503, detail="Dataset not loaded")

    capped = max(1, min(limit, 200))
    sample = _df.head(capped)
    return {"transactions": [_row_to_json(row) for _, row in sample.iterrows()]}


@app.get("/stream")
async def stream_rows() -> StreamingResponse:
    if _df is None:
        raise HTTPException(status_code=503, detail="Dataset not loaded")

    async def event_generator():
        while True:
            row = get_next_row()
            payload = await score_transaction(row)
            if payload is None:
                payload = row
            yield f"data: {json.dumps(payload)}\n\n"
            await asyncio.sleep(STREAM_INTERVAL_SECONDS)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
