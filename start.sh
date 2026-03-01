#!/bin/bash
set -e

echo "Starting Mining App (Postgres Backend)..."

# Execute the main application command
# Using concurrently to run both frontends and the backend from the root dir.
cd /app
exec npx concurrently \
  "python3 backend/main.py" \
  "cd mining-viz && npm run dev -- --host 0.0.0.0 --port 5173" \
  "cd community-miner-viz && npm run dev -- --host 0.0.0.0 --port 5174"
