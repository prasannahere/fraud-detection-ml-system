ARG MODEL_VERSION=v1

FROM python:3.11-slim

ARG MODEL_VERSION
ENV MODEL_VERSION=${MODEL_VERSION}
ENV PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .
COPY src/ src/

EXPOSE 8000

LABEL org.opencontainers.image.title="fraud-api" \
      org.opencontainers.image.version="${MODEL_VERSION}"

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
