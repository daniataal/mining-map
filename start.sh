#!/bin/bash
set -e

echo "🚀 Starting Mining Intelligence Platform (v2-auto)..."

# Navigate to app directory
cd /app

# Ensure we have the right environment for frontend
export VITE_API_BASE=${VITE_API_BASE:-"http://localhost:8000"}

echo "📡 API Base set to: $VITE_API_BASE"

# Execute the main application command
# Using concurrently to run both frontends and the backend from the root dir.
exec npx concurrently \
  --kill-others \
  --prefix "[{name}]" \
  --names "BACKEND,ADMIN-UI,MINER-UI" \
  --prefix-colors "yellow,blue,green" \
  "python3 backend/main.py" \
  "cd mining-viz && npm run dev -- --host 0.0.0.0 --port 5173" \
  "cd community-miner-viz && npm run dev -- --host 0.0.0.0 --port 5174"
