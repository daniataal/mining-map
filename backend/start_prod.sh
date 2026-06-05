#!/bin/sh
set -eu

# Tier-1 production entrypoint: multi-process ASGI via gunicorn + uvicorn workers.
# Local dev: keep using `python main.py` (single uvicorn process).
WORKERS="${UVICORN_WORKERS:-2}"
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"

exec gunicorn main:app \
  --bind "${HOST}:${PORT}" \
  --workers "${WORKERS}" \
  --worker-class uvicorn.workers.UvicornWorker \
  --timeout 120 \
  --graceful-timeout 30 \
  --keep-alive 5 \
  --access-logfile - \
  --error-logfile -
