FROM google/cloud-sdk:slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 \
    && rm -rf /var/lib/apt/lists/*

COPY pipelines/ pipelines/
COPY training/ training/

RUN chmod +x pipelines/entrypoint.sh

LABEL org.opencontainers.image.title="fraud-pipelines" \
      org.opencontainers.image.description="Vertex AI pipeline compiler and uploader"

ENTRYPOINT ["pipelines/entrypoint.sh"]
CMD ["compile"]
