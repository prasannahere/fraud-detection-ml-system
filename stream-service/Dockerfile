FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .
COPY data/sample_transactions.csv /data/sample_transactions.csv

ENV DATA_FILE_PATH=/data/sample_transactions.csv
ENV STREAM_INTERVAL_SECONDS=1

EXPOSE 8000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
