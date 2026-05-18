"""Route Intelligence microservice — single responsibility: POST /plan."""

from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

# Defaults before importing route planner / geometry modules.
os.environ.setdefault("ROUTE_PLAN_DEADLINE_SEC", "120")
os.environ.setdefault("OSRM_GEOMETRY_CACHE_MAX", "8192")

logger = logging.getLogger("route_service")

try:
    from backend.services.route_planner import AIR_HUBS, MARITIME_HUBS, RAIL_HUBS, plan_route
    from backend.services.routing_geometry import configure_osrm_geometry_cache, osrm_cache_stats
except ImportError:
    from services.route_planner import AIR_HUBS, MARITIME_HUBS, RAIL_HUBS, plan_route  # type: ignore[no-redef]
    from services.routing_geometry import configure_osrm_geometry_cache, osrm_cache_stats  # type: ignore[no-redef]


class RoutePointPayload(BaseModel):
    name: Optional[str] = None
    lat: float
    lng: float
    kind: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None


class RoutePlanRequest(BaseModel):
    product: str
    quantity_tons: float
    origin: RoutePointPayload
    destination: RoutePointPayload
    transit_points: Optional[list[RoutePointPayload]] = None
    preferred_methods: Optional[list[str]] = None
    pipeline_layer_enabled: bool = False


def _preload_hub_catalogs() -> dict[str, int]:
    """Warm hub tuples in memory at startup (ports, airports, rail)."""
    counts = {
        "maritime_hubs": len(MARITIME_HUBS),
        "air_hubs": len(AIR_HUBS),
        "rail_hubs": len(RAIL_HUBS),
    }
    # Touch coordinates so pages are resident before first request.
    _ = sum(h.lat + h.lng for h in MARITIME_HUBS)
    _ = sum(h.lat + h.lng for h in AIR_HUBS)
    _ = sum(h.lat + h.lng for h in RAIL_HUBS)
    return counts


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logging.basicConfig(level=logging.INFO)
    max_entries = int(os.getenv("OSRM_GEOMETRY_CACHE_MAX", "8192"))
    configure_osrm_geometry_cache(max_entries=max_entries)
    hub_counts = _preload_hub_catalogs()
    logger.info(
        "route-service ready hubs=%s osrm_cache_max=%s deadline_sec=%s",
        hub_counts,
        max_entries,
        os.getenv("ROUTE_PLAN_DEADLINE_SEC", "120"),
    )
    yield


app = FastAPI(title="Mining Map Route Service", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "route-service",
        "hubs": {
            "maritime": len(MARITIME_HUBS),
            "air": len(AIR_HUBS),
            "rail": len(RAIL_HUBS),
        },
        "osrm_cache": osrm_cache_stats(),
        "deadline_sec": float(os.getenv("ROUTE_PLAN_DEADLINE_SEC", "120")),
    }


@app.post("/plan")
def create_plan(payload: RoutePlanRequest) -> dict[str, Any]:
    started = time.monotonic()
    request_payload = payload.model_dump()
    transit = request_payload.get("transit_points") or []
    request_payload["transit_points"] = [item for item in transit if isinstance(item, dict)]
    try:
        result = plan_route(request_payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception("route plan failed")
        raise HTTPException(status_code=500, detail=f"Route planning failed: {exc}") from exc
    elapsed = time.monotonic() - started
    limitations = result.get("limitations")
    if isinstance(limitations, list):
        result = {
            **result,
            "limitations": [
                *limitations,
                f"route-service resolved in {elapsed:.1f}s",
            ],
        }
    return result
