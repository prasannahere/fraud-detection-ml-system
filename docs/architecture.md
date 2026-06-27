# Architecture

## Layout

```
├── app/         # product/API/inference
├── training/    # model training code
├── pipelines/   # Vertex AI pipeline orchestration
├── infra/       # cloud setup
├── shared/      # reusable common code
├── tests/
└── docs/
```

## Components

| Package | Purpose |
|---------|---------|
| `app/api` | FastAPI fraud scoring service (predict, explain, drift) |
| `app/stream` | Transaction replay service for live demos |
| `app/frontend` | React dashboard |
| `shared` | Preprocessing, feature constants, drift statistics |
| `training` | Offline XGBoost training and artifact export (`training/Dockerfile`) |
| `pipelines` | Vertex AI pipeline compilation and upload (`pipelines/Dockerfile`) |
| `infra` | GCP bootstrap scripts (`infra/Dockerfile`) |

## Request flow

```mermaid
flowchart LR
    UI[frontend] --> Stream[stream-service]
    UI --> API[fraud-api]
    Stream --> API
    API --> GCS[(GCS model artifacts)]
    API --> BQ[(BigQuery audit)]
```

Training runs offline via `training/xgb_train.py`, Vertex AI custom jobs, or the local `pipelines/` container. Artifacts land in GCS and are mounted into Cloud Run at inference time.
