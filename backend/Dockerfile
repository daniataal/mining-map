ARG BASE_IMAGE=ghcr.io/daniataal/mining-map-base:latest
FROM ${BASE_IMAGE}

WORKDIR /app

# Copy large static data first to leverage Docker layer caching
# This 45MB layer will only be rebuilt if files in backend/data change.
COPY data/ ./data/

# Copy the rest of the backend code
COPY . .

# Expose backend port
EXPOSE 8000

# Start backend
CMD ["python", "main.py"]
