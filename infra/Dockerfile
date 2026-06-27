FROM google/cloud-sdk:slim

WORKDIR /app

COPY infra/setup.sh /app/setup.sh
RUN chmod +x /app/setup.sh

LABEL org.opencontainers.image.title="fraud-infra" \
      org.opencontainers.image.description="GCP bootstrap for fraud detection stack"

ENTRYPOINT ["/app/setup.sh"]
