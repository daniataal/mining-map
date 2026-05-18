ARG BASE_IMAGE=dannyatalla/mining-map-base:latest
FROM ${BASE_IMAGE}

WORKDIR /app

# Copy large static data first to leverage Docker layer caching
# This 45MB layer will only be rebuilt if files in backend/data change.
COPY data/ ./data/

COPY requirements.txt ./
RUN pip3 install --no-cache-dir -r requirements.txt

# Copy only the code directories and files, avoiding copying data/ again to prevent layer bloating and cache invalidation
COPY api/ ./api/
COPY schemas/ ./schemas/
COPY services/ ./services/
COPY tests/ ./tests/
COPY *.py ./
COPY route_service/ ./route_service/
COPY licenses.json ./

# Expose backend port
EXPOSE 8000

# Start backend
CMD ["python", "main.py"]
