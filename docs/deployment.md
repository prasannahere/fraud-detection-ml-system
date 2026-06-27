# Deployment

## Production architecture

**Vertex AI:** train → evaluate → write artifacts to `gs://<bucket>/models/xgb95/`

**Cloud Run:** `frontend` → `api` → load artifacts from GCS → predict (with auth, SHAP, drift)

Model updates do not require redeploying `api` if artifact paths stay the same.

---

## CI/CD (GitHub Actions)

Only **`deploy-app.yml`** runs automatically. It deploys the service(s) whose code changed:

| Changed paths | What deploys |
|---------------|--------------|
| `app/frontend/**` | frontend only |
| `app/api/**` or `shared/**` | api only |
| `app/stream/**` | stream only |

No CI for `training/`, `pipelines/`, or `infra/`.

**Manual:** `infra.yml` (GCP bootstrap) — run from Actions tab when needed.

---

## Local development

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

| Service | URL |
|---------|-----|
| api | http://localhost:8000 |
| stream | http://localhost:8001 |
| frontend | http://localhost:3000 |

---

## Vertex AI (manual)

Vertex mounts GCS buckets at `/gcs/<bucket-name>/...` (not `/mnt/gcs`, which is Cloud Run only).

1. Upload training data:
   ```bash
   gsutil cp data/train_transaction.csv gs://fraud-detection-500117-artifacts/data/
   gsutil cp data/train_identity.csv gs://fraud-detection-500117-artifacts/data/
   ```
2. Push training container to Artifact Registry:
   ```bash
   docker build -f training/Dockerfile -t us-central1-docker.pkg.dev/PROJECT/REPO/training:latest .
   docker push us-central1-docker.pkg.dev/PROJECT/REPO/training:latest
   ```
3. Create a **Custom training** job in Vertex AI using that image.
4. Set **Base output directory** to `gs://fraud-detection-500117-artifacts/models/xgb95/` (Vertex sets `AIP_MODEL_DIR`; the script normalizes that to the FUSE path your API reads).
5. Set container **arguments** (one per line):
   ```
   --train-transaction
   /gcs/fraud-detection-500117-artifacts/data/train_transaction.csv
   --train-identity
   /gcs/fraud-detection-500117-artifacts/data/train_identity.csv
   --output-dir
   /gcs/fraud-detection-500117-artifacts/models/xgb95
   ```
   Or leave arguments empty and set environment variable `GCS_ARTIFACTS_BUCKET=fraud-detection-500117-artifacts` on the job.
6. Optionally compile and upload pipeline spec:
   ```bash
   docker compose -f infra/docker-compose.yml --profile jobs run --rm pipelines compile-and-upload
   ```

Required GitHub secrets (for app deploy only): `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `JWT_SECRET`, `FRAUD_AUTH_USERS`, `FRAUD_AUTH_USERNAME`, `FRAUD_AUTH_PASSWORD`.

---

## Migrating from old service names

If you previously deployed `fraud-api` and `stream-service`, the next CI run creates new Cloud Run services **`api`** and **`stream`**. Delete the old services in GCP Console when you've verified the new ones work.
