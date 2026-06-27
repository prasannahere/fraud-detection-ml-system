# Deployment

## Production architecture

**Vertex AI:** train → evaluate → write artifacts to `gs://<bucket>/models/xgb95/`

**Cloud Run:** `frontend` → `fraud-api` → load artifacts from GCS → predict (with auth, SHAP, drift)

Model updates do not require redeploying `fraud-api` if artifact paths stay the same.

---

## CI/CD (GitHub Actions)

Only **`deploy-app.yml`** runs automatically. It deploys the service(s) whose code changed:

| Changed paths | What deploys |
|---------------|--------------|
| `app/frontend/**` | frontend only |
| `app/api/**` or `shared/**` | fraud-api only |
| `app/stream/**` | stream-service only |

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
| fraud-api | http://localhost:8000 |
| stream-service | http://localhost:8001 |
| frontend | http://localhost:3000 |

---

## Vertex AI (manual)

1. Push training container to Artifact Registry:
   ```bash
   docker build -f training/Dockerfile -t us-central1-docker.pkg.dev/PROJECT/REPO/training:latest .
   docker push us-central1-docker.pkg.dev/PROJECT/REPO/training:latest
   ```
2. Create a **Custom training** job in Vertex AI using that image.
3. Set output to GCS (`AIP_MODEL_DIR` / bucket mount) under `models/xgb95/`.
4. Optionally compile and upload pipeline spec:
   ```bash
   docker compose -f infra/docker-compose.yml --profile jobs run --rm pipelines compile-and-upload
   ```

Required GitHub secrets (for app deploy only): `GCP_WORKLOAD_IDENTITY_PROVIDER`, `GCP_SERVICE_ACCOUNT`, `JWT_SECRET`, `FRAUD_AUTH_USERS`, `FRAUD_AUTH_USERNAME`, `FRAUD_AUTH_PASSWORD`.
