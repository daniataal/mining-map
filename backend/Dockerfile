ARG BASE_IMAGE=dannyatalla/mining-map-base:latest
FROM ${BASE_IMAGE}

WORKDIR /app

# Copy large static data first to leverage Docker layer caching
# This 45MB layer will only be rebuilt if files in backend/data change.
COPY data/ ./data/

# Copy only the code directories and files, avoiding copying data/ again to prevent layer bloating and cache invalidation
COPY api/ ./api/
COPY schemas/ ./schemas/
COPY services/ ./services/
COPY tests/ ./tests/
COPY *.py ./
COPY requirements.txt ./
COPY licenses.json ./

# Expose backend port
EXPOSE 8000

# Start backend
CMD ["python", "main.py"]
