FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY worker/requirements.txt ./worker/requirements.txt
RUN pip install --no-cache-dir -r worker/requirements.txt

COPY backend ./backend
COPY worker ./worker

ENV PYTHONPATH=/app/backend

WORKDIR /app/worker

CMD ["python", "worker.py"]
