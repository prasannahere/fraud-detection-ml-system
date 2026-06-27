# Deployment

## Local development (app stack)

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

| Service | URL |
|---------|-----|
| fraud-api | http://localhost:8000 |
| stream-service | http://localhost:8001 |
| frontend | http://localhost:3000 |

Place model artifacts in `app/api/model/` for local inference.

## Module containers

All non-app modules have dedicated Docker images built from the repo root.

| Module | Dockerfile | Image purpose |
|--------|------------|---------------|
| `training/` | `training/Dockerfile` | Run `xgb_train.py` with mounted data and output dirs |
| `pipelines/` | `pipelines/Dockerfile` | Compile Vertex pipeline spec; optional GCS upload |
| `infra/` | `infra/Dockerfile` | Bootstrap GCP buckets, Artifact Registry, APIs |

### Build images locally

```bash
docker build -f training/Dockerfile -t fraud-training .
docker build -f pipelines/Dockerfile -t fraud-pipelines .
docker build -f infra/Dockerfile -t fraud-infra .
```

### Run training container

```bash
mkdir -p outputs/model
docker run --rm \
  -v "$PWD/data:/data:ro" \
  -v "$PWD/outputs:/outputs" \
  fraud-training \
  --train-transaction /data/train_transaction.csv \
  --train-identity /data/train_identity.csv \
  --test-transaction /data/test_transaction.csv \
  --test-identity /data/test_identity.csv \
  --output-dir /outputs/model
```

### Run pipelines container

```bash
# Compile only
docker run --rm \
  -e TRAINING_IMAGE=fraud-training \
  -e INFRA_IMAGE=fraud-infra \
  -v "$PWD/pipelines/compiled:/app/pipelines/compiled" \
  fraud-pipelines compile

# Compile and upload (requires gcloud auth)
docker run --rm \
  -e GCS_ARTIFACTS_BUCKET=fraud-detection-500117-artifacts \
  -e TRAINING_IMAGE=us-central1-docker.pkg.dev/PROJECT/REPO/training:latest \
  -e INFRA_IMAGE=us-central1-docker.pkg.dev/PROJECT/REPO/infra:latest \
  -v "$PWD/pipelines/compiled:/app/pipelines/compiled" \
  -v "$HOME/.config/gcloud:/root/.config/gcloud:ro" \
  fraud-pipelines compile-and-upload
```

### Run infra container

```bash
docker run --rm \
  -e GCP_PROJECT_ID=fraud-detection-500117 \
  -e GCP_REGION=us-central1 \
  -e AR_REPOSITORY=fraud-detection-repo \
  -e GCS_ARTIFACTS_BUCKET=fraud-detection-500117-artifacts \
  -v "$HOME/.config/gcloud:/root/.config/gcloud:ro" \
  fraud-infra
```

### Compose job profile

One-off jobs via Compose (requires `data/` and authenticated gcloud for upload/infra):

```bash
docker compose -f infra/docker-compose.yml --profile jobs run --rm training
docker compose -f infra/docker-compose.yml --profile jobs run --rm pipelines compile-and-upload
docker compose -f infra/docker-compose.yml --profile jobs run --rm infra
```

## Cloud Run (CI/CD)

| Workflow | Trigger | Container action |
|----------|---------|------------------|
| `deploy-app.yml` | Push to `main` (app/shared) | Build and deploy API, stream, frontend |
| `train-model.yml` | Manual or training changes | Train locally in CI, upload model artifacts to GCS |
| `infra.yml` | Manual or infra changes | Build `infra` image, run GCP bootstrap |

Vertex AI (custom training jobs, pipeline specs) is **not** deployed by GitHub Actions. Push training/pipeline images and configure jobs manually in the GCP console.

Required GitHub secrets: `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `JWT_SECRET`, `FRAUD_AUTH_USERS`, `FRAUD_AUTH_USERNAME`, `FRAUD_AUTH_PASSWORD`.
