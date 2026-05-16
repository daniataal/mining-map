ARG BASE_IMAGE=ghcr.io/daniataal/mining-map-base:latest
FROM ${BASE_IMAGE}

# Set working directory
WORKDIR /app

# Copy dependency files first
COPY mining-viz/package*.json ./mining-viz/
COPY community-miner-viz/package*.json ./community-miner-viz/

# Install frontend dependencies
RUN cd mining-viz && npm install
RUN cd community-miner-viz && npm install

# Copy the rest of the application
COPY . .

# Ensure start script is executable and has LF endings
RUN dos2unix start.sh && chmod +x start.sh

# Build frontends (Production optimization)
# We use build || true to prevent failure if some components are missing during dev setup
RUN cd mining-viz && npm run build || true
RUN cd community-miner-viz && npm run build || true

# Expose the ports
# 8000: Backend API
# 5173: Admin Vite Frontend
# 5174: Community Miner Vite Frontend
EXPOSE 8000 5173 5174

# Use the startup script from its root location
CMD ["./start.sh"]
