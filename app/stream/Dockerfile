FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py scoring.py .

ENV STREAM_INTERVAL_SECONDS=0.5

EXPOSE 8000

LABEL org.opencontainers.image.title="stream"

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
