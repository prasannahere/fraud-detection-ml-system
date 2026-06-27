FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

COPY training/requirements.txt training/requirements.txt
RUN pip install --no-cache-dir -r training/requirements.txt

COPY shared/ shared/
COPY training/ training/

RUN mkdir -p /data /outputs

LABEL org.opencontainers.image.title="fraud-training" \
      org.opencontainers.image.description="XGBoost training job for fraud detection"

ENTRYPOINT ["python", "training/xgb_train.py"]
CMD ["--help"]
