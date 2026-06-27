"""Pydantic schemas for the fraud prediction API."""

from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


class TransactionInput(BaseModel):
    """Raw IEEE-CIS transaction (+ optional identity) fields."""

    # Allow V1–V339 and other IEEE columns from the live stream (preprocessor selects features).
    model_config = ConfigDict(extra="allow", populate_by_name=True)

    TransactionID: Optional[int] = Field(default=None, ge=1)
    TransactionDT: float = Field(..., ge=0)
    TransactionAmt: float = Field(..., gt=0)
    ProductCD: Optional[str] = Field(default=None, min_length=1, max_length=8)
    card1: Optional[float] = None
    card2: Optional[float] = None
    card3: Optional[float] = None
    card4: Optional[str] = None
    card5: Optional[float] = None
    card6: Optional[str] = None
    addr1: Optional[float] = None
    addr2: Optional[float] = None
    dist1: Optional[float] = None
    dist2: Optional[float] = None
    P_emaildomain: Optional[str] = None
    R_emaildomain: Optional[str] = None
    C1: Optional[float] = Field(default=None, ge=0)
    C2: Optional[float] = Field(default=None, ge=0)
    C3: Optional[float] = Field(default=None, ge=0)
    C4: Optional[float] = Field(default=None, ge=0)
    C5: Optional[float] = Field(default=None, ge=0)
    C6: Optional[float] = Field(default=None, ge=0)
    C7: Optional[float] = Field(default=None, ge=0)
    C8: Optional[float] = Field(default=None, ge=0)
    C9: Optional[float] = Field(default=None, ge=0)
    C10: Optional[float] = Field(default=None, ge=0)
    C11: Optional[float] = Field(default=None, ge=0)
    C12: Optional[float] = Field(default=None, ge=0)
    C13: Optional[float] = Field(default=None, ge=0)
    C14: Optional[float] = Field(default=None, ge=0)
    D1: Optional[float] = None
    D2: Optional[float] = None
    D3: Optional[float] = None
    D4: Optional[float] = None
    D5: Optional[float] = None
    D6: Optional[float] = None
    D7: Optional[float] = None
    D8: Optional[float] = None
    D9: Optional[float] = None
    D10: Optional[float] = None
    D11: Optional[float] = None
    D12: Optional[float] = None
    D13: Optional[float] = None
    D14: Optional[float] = None
    D15: Optional[float] = None
    M1: Optional[str] = None
    M2: Optional[str] = None
    M3: Optional[str] = None
    M4: Optional[str] = None
    M5: Optional[str] = None
    M6: Optional[str] = None
    M7: Optional[str] = None
    M8: Optional[str] = None
    M9: Optional[str] = None
    DeviceType: Optional[str] = None
    DeviceInfo: Optional[str] = None
    id_12: Optional[str] = Field(default=None, alias="id-12")
    id_15: Optional[str] = Field(default=None, alias="id-15")
    id_16: Optional[str] = Field(default=None, alias="id-16")
    id_23: Optional[str] = Field(default=None, alias="id-23")
    id_27: Optional[str] = Field(default=None, alias="id-27")
    id_28: Optional[str] = Field(default=None, alias="id-28")
    id_29: Optional[str] = Field(default=None, alias="id-29")
    id_30: Optional[str] = Field(default=None, alias="id-30")
    id_31: Optional[str] = Field(default=None, alias="id-31")
    id_33: Optional[str] = Field(default=None, alias="id-33")
    id_34: Optional[str] = Field(default=None, alias="id-34")
    id_35: Optional[str] = Field(default=None, alias="id-35")
    id_36: Optional[str] = Field(default=None, alias="id-36")
    id_37: Optional[str] = Field(default=None, alias="id-37")
    id_38: Optional[str] = Field(default=None, alias="id-38")

    @field_validator("TransactionAmt")
    @classmethod
    def validate_amount(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("TransactionAmt must be greater than 0")
        return value


class BatchTransactionInput(BaseModel):
    transactions: list[TransactionInput] = Field(..., min_length=1, max_length=1000)


class PredictionResponse(BaseModel):
    fraud_probability: float = Field(..., ge=0.0, le=1.0)
    decision: str
    threshold_used: float
    model_version: str


class BatchPredictionItem(BaseModel):
    index: int
    fraud_probability: float
    decision: str


class BatchPredictionResponse(BaseModel):
    predictions: list[BatchPredictionItem]
    threshold_used: float
    model_version: str


class ExplainResponse(BaseModel):
    fraud_probability: float
    decision: str
    threshold_used: float
    top_features: list[dict[str, Any]]
    positive_contributors: list[dict[str, Any]] = Field(default_factory=list)
    negative_contributors: list[dict[str, Any]] = Field(default_factory=list)


class FeatureDriftItem(BaseModel):
    feature: str
    drift_score: float
    status: str
    batch_mean: float
    training_mean: float


class FeatureDriftResponse(BaseModel):
    drift_detected: bool
    high_drift_count: int = 0
    message: Optional[str] = None
    features: list[FeatureDriftItem] = Field(default_factory=list)


class ModelInfoResponse(BaseModel):
    model_name: str
    version: str
    auc: Optional[float] = None
    threshold: float
    features: Optional[int] = None
    artifacts_loaded: bool
    features_aligned: bool = False
    docker_tags: list[str] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    encoders_loaded: bool
    features_loaded: bool = False
    features_aligned: bool = False
    model_feature_count: Optional[int] = None
    version: str


class DriftResponse(BaseModel):
    drift_detected: bool
    columns: list[dict[str, Any]]
    message: Optional[str] = None


class ErrorResponse(BaseModel):
    detail: str


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1)
    password: str = Field(..., min_length=1)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
