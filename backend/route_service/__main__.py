"""Run with: python -m route_service"""

import os

import uvicorn

if __name__ == "__main__":
    host = os.getenv("ROUTE_SERVICE_HOST", "0.0.0.0")
    port = int(os.getenv("ROUTE_SERVICE_PORT", "8001"))
    uvicorn.run(
        "route_service.app:app",
        host=host,
        port=port,
        log_level=os.getenv("ROUTE_SERVICE_LOG_LEVEL", "info"),
    )
