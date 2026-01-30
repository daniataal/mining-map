# Mining Map Visualization

A full-stack application for visualizing mining licenses on an interactive map.

## 🚀 Quick Start (Docker)

The easiest way to run the application is using Docker.

### 1. Run the Container
Run the following command to start the application with a persistent database.
Replace `YOUR_SERVER_IP` with your actual IP address (e.g. `129.159.148.51`).

```bash
sudo docker run -d \
  -e VITE_API_BASE=http://YOUR_SERVER_IP:8000 \
  -p 8000:8000 \
  -p 5173:5173 \
  -v /opt/mining-map:/data \
  -e MINING_DB_PATH=/data/mining.db \
  --name mining-map-v2 \
  dannyatalla/mining-map:v2
```

### 2. Access the Application
*   **Frontend**: `http://YOUR_SERVER_IP:5173`
*   **Backend API**: `http://YOUR_SERVER_IP:8000/licenses`

### 3. Troubleshooting
If you see **"Database error"** or permissions issues:
1.  Stop the container: `sudo docker rm -f mining-map-v2`
2.  Clear the bad volume path on the server: `sudo rm -rf /opt/mining-map/mining.db`
3.  Pre-create the folder: `sudo mkdir -p /opt/mining-map`
4.  Run the container command again.

## 🛠️ Local Development

### Backend (Python/FastAPI)
```bash
cd backend
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install fastapi uvicorn
python main.py
```

### Frontend (React/Vite)
```bash
cd mining-viz
npm install
npm run dev
```

## 📂 Project Structure
*   `/backend` - FastAPI server and SQLite database logic.
*   `/mining-viz` - React frontend with Leaflet maps.
*   `Dockerfile` - Container definition.
*   `start.sh` - Startup script that handles DB persistence and permissions.
