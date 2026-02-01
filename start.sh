#!/bin/bash
set -e

echo "Starting Mining App (Postgres Backend)..."

# Execute the main application command
# Using concurrently to run frontend and backend
# Backend is at /app/backend/main.py (based on context)
# Frontend should be served via vite or built static? 
# The Dockerfile runs npm run build, but then runs start.sh.
# Dev mode uses 'npx vite --host'.

exec npm run dev -- --host
