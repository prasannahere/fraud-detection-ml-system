#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-compile}"
shift || true

case "${ACTION}" in
  compile)
    python3 pipelines/vertex_pipeline.py "$@"
    ;;
  upload)
    python3 pipelines/vertex_pipeline.py "$@"
    : "${GCS_ARTIFACTS_BUCKET:?GCS_ARTIFACTS_BUCKET is required for upload}"
    gsutil cp pipelines/compiled/train_pipeline.json \
      "gs://${GCS_ARTIFACTS_BUCKET}/pipelines/train_pipeline.json"
    echo "Uploaded pipeline spec to gs://${GCS_ARTIFACTS_BUCKET}/pipelines/train_pipeline.json"
    ;;
  compile-and-upload)
    python3 pipelines/vertex_pipeline.py "$@"
    : "${GCS_ARTIFACTS_BUCKET:?GCS_ARTIFACTS_BUCKET is required for upload}"
    gsutil cp pipelines/compiled/train_pipeline.json \
      "gs://${GCS_ARTIFACTS_BUCKET}/pipelines/train_pipeline.json"
    echo "Uploaded pipeline spec to gs://${GCS_ARTIFACTS_BUCKET}/pipelines/train_pipeline.json"
    ;;
  *)
    echo "Usage: entrypoint.sh {compile|upload|compile-and-upload} [vertex_pipeline.py args...]" >&2
    exit 1
    ;;
esac
