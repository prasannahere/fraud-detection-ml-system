"""Production FastAPI service for IEEE fraud detection."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

import pandas as pd
from fastapi import Depends, FastAPI, HTTPException, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from src.audit import write_prediction_audit
from src.auth import create_access_token, verify_credentials, verify_jwt
from src.config import JWT_EXPIRE_MINUTES, MODEL_VERSION
from src.drift import check_drift, compute_feature_drift
from src.logging_utils import configure_logging, log_prediction_request
from src.predict import (
    ArtifactError,
    FeatureValidationError,
    _prepare_features,
    artifacts_status,
    explain_fraud,
    get_model_info,
    predict_fraud,
    predict_fraud_batch,
    warmup_artifacts,
)
from src.schemas import (
    BatchPredictionResponse,
    BatchTransactionInput,
    DriftResponse,
    ErrorResponse,
    ExplainResponse,
    FeatureDriftResponse,
    HealthResponse,
    LoginRequest,
    ModelInfoResponse,
    PredictionResponse,
    TokenResponse,
    TransactionInput,
)

configure_logging()
logger = logging.getLogger("fraud_api")


@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        warmup_artifacts()
        logger.info("Model artifacts loaded at startup")
    except Exception as exc:
        logger.error("Failed to load model artifacts at startup: %s", exc)
    yield


app = FastAPI(
    title="Fraud Detection API",
    version=MODEL_VERSION,
    description="Production-grade IEEE-CIS fraud scoring service",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(ArtifactError)
async def artifact_error_handler(_: Request, exc: ArtifactError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content=ErrorResponse(detail=str(exc)).model_dump(),
    )


@app.exception_handler(FeatureValidationError)
async def feature_validation_handler(_: Request, exc: FeatureValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=ErrorResponse(detail=str(exc)).model_dump(),
    )


@app.exception_handler(RequestValidationError)
async def validation_error_handler(_: Request, exc: RequestValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content=ErrorResponse(detail=str(exc.errors())).model_dump(),
    )


@app.exception_handler(Exception)
async def unhandled_error_handler(_: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled error: %s", exc)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content=ErrorResponse(detail="Internal server error").model_dump(),
    )


def _to_dataframe(transaction: TransactionInput) -> pd.DataFrame:
    payload = transaction.model_dump(by_alias=False, exclude_none=True)
    return pd.DataFrame([payload])


def _to_batch_dataframe(batch: BatchTransactionInput) -> pd.DataFrame:
    rows = [item.model_dump(by_alias=False, exclude_none=True) for item in batch.transactions]
    return pd.DataFrame(rows)


@app.post("/auth/login", response_model=TokenResponse)
def login(body: LoginRequest) -> TokenResponse:
    if not verify_credentials(body.username, body.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password",
        )
    token = create_access_token(body.username)
    return TokenResponse(
        access_token=token,
        expires_in=JWT_EXPIRE_MINUTES * 60,
    )


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    status_map = artifacts_status()
    ready = (
        status_map["model_loaded"]
        and status_map["encoders_loaded"]
        and status_map.get("features_loaded", False)
    )
    return HealthResponse(
        status="ok" if ready and status_map.get("features_aligned", False) else "degraded",
        model_loaded=status_map["model_loaded"],
        encoders_loaded=status_map["encoders_loaded"],
        features_loaded=status_map.get("features_loaded", False),
        features_aligned=status_map.get("features_aligned", False),
        model_feature_count=status_map.get("model_feature_count"),
        version=MODEL_VERSION,
    )


@app.get("/model-info", response_model=ModelInfoResponse, dependencies=[Depends(verify_jwt)])
def model_info() -> ModelInfoResponse:
    return ModelInfoResponse(**get_model_info())


@app.post("/predict", response_model=PredictionResponse, dependencies=[Depends(verify_jwt)])
def predict(
    transaction: TransactionInput,
    threshold: float | None = Query(default=None, ge=0.0, le=1.0),
) -> PredictionResponse:
    with log_prediction_request("/predict") as log_ctx:
        result = predict_fraud(_to_dataframe(transaction), threshold=threshold)
        log_ctx.update(
            {
                "fraud_probability": result["fraud_probability"],
                "decision": result["decision"],
                "threshold_used": result["threshold_used"],
            }
        )
        write_prediction_audit(
            {
                "endpoint": "/predict",
                "fraud_probability": result["fraud_probability"],
                "decision": result["decision"],
                "threshold_used": result["threshold_used"],
                "transaction_id": transaction.TransactionID,
            }
        )
        return PredictionResponse(**{k: v for k, v in result.items() if k in PredictionResponse.model_fields})


@app.post("/predict_batch", response_model=BatchPredictionResponse, dependencies=[Depends(verify_jwt)])
def predict_batch(
    batch: BatchTransactionInput,
    threshold: float | None = Query(default=None, ge=0.0, le=1.0),
) -> BatchPredictionResponse:
    with log_prediction_request("/predict_batch", {"batch_size": len(batch.transactions)}) as log_ctx:
        result = predict_fraud_batch(_to_batch_dataframe(batch), threshold=threshold)
        log_ctx["threshold_used"] = result["threshold_used"]
        write_prediction_audit(
            {
                "endpoint": "/predict_batch",
                "batch_size": len(batch.transactions),
                "threshold_used": result["threshold_used"],
            }
        )
        return BatchPredictionResponse(**result)


@app.post("/explain", response_model=ExplainResponse, dependencies=[Depends(verify_jwt)])
def explain(
    transaction: TransactionInput,
    threshold: float | None = Query(default=None, ge=0.0, le=1.0),
    top_k: int = Query(default=10, ge=1, le=50),
) -> ExplainResponse:
    with log_prediction_request("/explain") as log_ctx:
        result = explain_fraud(_to_dataframe(transaction), threshold=threshold, top_k=top_k)
        log_ctx.update(
            {
                "fraud_probability": result["fraud_probability"],
                "decision": result["decision"],
            }
        )
        return ExplainResponse(**result)


@app.post("/drift-check", response_model=DriftResponse, dependencies=[Depends(verify_jwt)])
def drift_check(transaction: TransactionInput) -> DriftResponse:
    df = _to_dataframe(transaction)
    result = check_drift(df)
    return DriftResponse(**result)


@app.post("/drift/monitor", response_model=FeatureDriftResponse, dependencies=[Depends(verify_jwt)])
def drift_monitor(batch: BatchTransactionInput) -> FeatureDriftResponse:
    raw_df = _to_batch_dataframe(batch)
    _, features_df, _ = _prepare_features(raw_df)
    result = compute_feature_drift(raw_df, features_df)
    return FeatureDriftResponse(**result)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": "api", "docs": "/docs", "health": "/health"}
