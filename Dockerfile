FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Update and install system dependencies
# python-is-python3 aliases 'python' to 'python3'
RUN apt-get update && apt-get install -y \
    curl \
    python3 \
    python3-pip \
    python-is-python3 \
    dos2unix \
    && rm -rf /var/lib/apt/lists/*

# Install Node.js 20.x
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs

# Set working directory
WORKDIR /app

# Install Python dependencies globally (ok for container)
# We assume requirements are minimal: fastapi, uvicorn
RUN pip3 install fastapi uvicorn python-multipart psycopg2-binary bcrypt pyjwt requests

# Copy the entire project
COPY . .

# Install Frontend dependencies
WORKDIR /app/mining-viz
RUN npm install

# Create a directory for persistent data
RUN mkdir -p /data

# Copy and prepare startup script
COPY start.sh /usr/local/bin/start.sh
RUN dos2unix /usr/local/bin/start.sh && chmod +x /usr/local/bin/start.sh

# Build frontend
RUN npm run build

# Expose the ports
# 8000: Backend API
# 5173: Vite Frontend
EXPOSE 8000
EXPOSE 5173

# Use the startup script
CMD ["/usr/local/bin/start.sh"]
