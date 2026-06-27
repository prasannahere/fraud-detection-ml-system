#!/usr/bin/env bash
set -euo pipefail

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${AR_REPOSITORY:?AR_REPOSITORY is required}"
: "${GCS_ARTIFACTS_BUCKET:?GCS_ARTIFACTS_BUCKET is required}"

echo "Ensuring Artifact Registry repository exists..."
gcloud artifacts repositories describe "${AR_REPOSITORY}" \
  --location="${GCP_REGION}" \
  --project="${GCP_PROJECT_ID}" >/dev/null 2>&1 || \
gcloud artifacts repositories create "${AR_REPOSITORY}" \
  --repository-format=docker \
  --location="${GCP_REGION}" \
  --project="${GCP_PROJECT_ID}"

echo "Ensuring GCS artifacts bucket exists..."
gsutil ls -b "gs://${GCS_ARTIFACTS_BUCKET}" >/dev/null 2>&1 || \
gsutil mb -l "${GCP_REGION}" -p "${GCP_PROJECT_ID}" "gs://${GCS_ARTIFACTS_BUCKET}"

echo "Ensuring required Cloud Run APIs are enabled..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  --project="${GCP_PROJECT_ID}"

echo "Infra setup complete."
