ARG BASE_IMAGE=dannyatalla/mining-map-base:latest
FROM ${BASE_IMAGE}

WORKDIR /app

# Copy dependency files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Expose Vite port
EXPOSE 5174

# Default to development mode
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5174"]
