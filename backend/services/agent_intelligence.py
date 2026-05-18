from __future__ import annotations

import hashlib
import json
import math
import os
import re
import uuid
from datetime import datetime
from typing import Any, Optional

try:
    from psycopg2.extras import Json, RealDictCursor
except ImportError:  # pragma: no cover - tests can import without psycopg2 extras.
    RealDictCursor = None

    def Json(value: Any) -> Any:
        return value

try:
    from backend.services.entity_contacts import (
        build_license_contact_candidates,
        upsert_entity_contact_candidates,
    )
    from backend.services.entity_relationships import build_license_relationship_candidates
except ImportError:
    from services.entity_contacts import (  # type: ignore[no-redef]
        build_license_contact_candidates,
        upsert_entity_contact_candidates,
    )
    from services.entity_relationships import build_license_relationship_candidates  # type: ignore[no-redef]


AGENT_JOB_TYPES = {
    "route_intelligence",
    "contact_enrichment",
    "operator_validation",
    "data_validation",
    "due_diligence_summary",
    "procurement_summary",
}

CONTACT_TYPE_ORDER = {"phone": 0, "email": 1, "website": 2, "address": 3}
URL_RE = re.compile(r"^https?://", re.IGNORECASE)


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def stable_input_hash(payload: Any) -> str:
    normalized = json.dumps(payload, sort_keys=True, ensure_ascii=True, default=_json_default, separators=(",", ":"))
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def _jsonb(value: Any) -> Json:
    return Json(value, dumps=lambda obj: json.dumps(obj, default=_json_default))


def _cursor_kwargs() -> dict[str, Any]:
    if RealDictCursor is None:
        return {}
    return {"cursor_factory": RealDictCursor}


def _row_to_dict(row: Any) -> dict[str, Any]:
    if row is None:
        return {}
    if hasattr(row, "keys"):
        return dict(row)
    return dict(row)


def ensure_agent_jobs_table(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS agent_jobs (
                job_id VARCHAR(255) PRIMARY KEY,
                agent_type VARCHAR(80) NOT NULL,
                status VARCHAR(40) NOT NULL,
                entity_id VARCHAR(255),
                route_hash TEXT,
                input_hash TEXT NOT NULL,
                input_json JSONB,
                output_json JSONB,
                error TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        cur.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_jobs_type_input_hash
            ON agent_jobs (agent_type, input_hash);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_agent_jobs_entity_type_created
            ON agent_jobs (entity_id, agent_type, created_at DESC);
            """
        )


def _serialize_job(row: dict[str, Any], *, cached: bool = False) -> dict[str, Any]:
    return {
        "job_id": row.get("job_id"),
        "agent_type": row.get("agent_type"),
        "status": row.get("status"),
        "entity_id": row.get("entity_id"),
        "route_hash": row.get("route_hash"),
        "input_hash": row.get("input_hash"),
        "input": row.get("input_json"),
        "output": row.get("output_json"),
        "error": row.get("error"),
        "created_at": row.get("created_at"),
        "updated_at": row.get("updated_at"),
        "cached": cached,
    }


def _select_job_by_type_hash(conn: Any, agent_type: str, input_hash: str) -> Optional[dict[str, Any]]:
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            SELECT job_id, agent_type, status, entity_id, route_hash, input_hash,
                   input_json, output_json, error, created_at, updated_at
            FROM agent_jobs
            WHERE agent_type = %s
              AND input_hash = %s
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (agent_type, input_hash),
        )
        row = cur.fetchone()
    if not row:
        return None
    return _serialize_job(_row_to_dict(row))


def get_agent_job(conn: Any, job_id: str) -> Optional[dict[str, Any]]:
    ensure_agent_jobs_table(conn)
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            SELECT job_id, agent_type, status, entity_id, route_hash, input_hash,
                   input_json, output_json, error, created_at, updated_at
            FROM agent_jobs
            WHERE job_id = %s
            """,
            (job_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    return _serialize_job(_row_to_dict(row))


def _cached_completed_job(conn: Any, agent_type: str, input_hash: str) -> Optional[dict[str, Any]]:
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            SELECT job_id, agent_type, status, entity_id, route_hash, input_hash,
                   input_json, output_json, error, created_at, updated_at
            FROM agent_jobs
            WHERE agent_type = %s
              AND input_hash = %s
              AND status = 'completed'
            ORDER BY updated_at DESC
            LIMIT 1
            """,
            (agent_type, input_hash),
        )
        row = cur.fetchone()
    if not row:
        return None
    return _serialize_job(_row_to_dict(row), cached=True)


def _insert_job(
    conn: Any,
    *,
    agent_type: str,
    input_hash: str,
    input_json: dict[str, Any],
    entity_id: Optional[str] = None,
    route_hash: Optional[str] = None,
    status: str = "running",
) -> str:
    job_id = str(uuid.uuid4())
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO agent_jobs (
                job_id, agent_type, status, entity_id, route_hash, input_hash, input_json, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
            ON CONFLICT (agent_type, input_hash) DO NOTHING
            """,
            (job_id, agent_type, status, entity_id, route_hash, input_hash, _jsonb(input_json)),
        )
        if cur.rowcount == 0:
            cur.execute(
                """
                SELECT job_id
                FROM agent_jobs
                WHERE agent_type = %s AND input_hash = %s
                ORDER BY updated_at DESC
                LIMIT 1
                """,
                (agent_type, input_hash),
            )
            row = cur.fetchone()
            if row:
                return row[0] if not hasattr(row, "keys") else row["job_id"]
    return job_id


def _mark_job_running(conn: Any, job_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE agent_jobs
            SET status = 'running',
                error = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE job_id = %s
            """,
            (job_id,),
        )


def _requeue_job(
    conn: Any,
    *,
    job_id: str,
    input_json: dict[str, Any],
    entity_id: Optional[str] = None,
    route_hash: Optional[str] = None,
) -> dict[str, Any]:
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            UPDATE agent_jobs
            SET status = 'queued',
                entity_id = %s,
                route_hash = %s,
                input_json = %s,
                output_json = NULL,
                error = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE job_id = %s
            RETURNING job_id, agent_type, status, entity_id, route_hash, input_hash,
                      input_json, output_json, error, created_at, updated_at
            """,
            (entity_id, route_hash, _jsonb(input_json), job_id),
        )
        row = cur.fetchone()
    return _serialize_job(_row_to_dict(row))


def enqueue_agent_job(
    conn: Any,
    *,
    agent_type: str,
    input_json: dict[str, Any],
    entity_id: Optional[str] = None,
    route_hash: Optional[str] = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    if agent_type not in AGENT_JOB_TYPES:
        raise ValueError(f"Unsupported agent_type: {agent_type}")
    ensure_agent_jobs_table(conn)
    input_hash = stable_input_hash(input_json)
    if not force_refresh:
        cached = _cached_completed_job(conn, agent_type, input_hash)
        if cached:
            return cached

    job_id = _insert_job(
        conn,
        agent_type=agent_type,
        input_hash=input_hash,
        input_json=input_json,
        entity_id=entity_id,
        route_hash=route_hash,
        status="queued",
    )
    existing = _select_job_by_type_hash(conn, agent_type, input_hash)
    if existing and (force_refresh or existing.get("status") == "failed"):
        existing = _requeue_job(
            conn,
            job_id=job_id,
            input_json=input_json,
            entity_id=entity_id,
            route_hash=route_hash,
        )
    conn.commit()
    return existing or get_agent_job(conn, job_id) or {
        "job_id": job_id,
        "agent_type": agent_type,
        "status": "queued",
        "entity_id": entity_id,
        "route_hash": route_hash,
        "input_hash": input_hash,
        "input": input_json,
        "output": None,
        "error": None,
        "cached": False,
    }


def _complete_job(conn: Any, job_id: str, output: dict[str, Any]) -> dict[str, Any]:
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            UPDATE agent_jobs
            SET status = 'completed',
                output_json = %s,
                error = NULL,
                updated_at = CURRENT_TIMESTAMP
            WHERE job_id = %s
            RETURNING job_id, agent_type, status, entity_id, route_hash, input_hash,
                      input_json, output_json, error, created_at, updated_at
            """,
            (_jsonb(output), job_id),
        )
        row = cur.fetchone()
    conn.commit()
    return _serialize_job(_row_to_dict(row))


def _fail_job(conn: Any, job_id: str, error: str) -> dict[str, Any]:
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            UPDATE agent_jobs
            SET status = 'failed',
                error = %s,
                updated_at = CURRENT_TIMESTAMP
            WHERE job_id = %s
            RETURNING job_id, agent_type, status, entity_id, route_hash, input_hash,
                      input_json, output_json, error, created_at, updated_at
            """,
            (error[:2000], job_id),
        )
        row = cur.fetchone()
    conn.commit()
    return _serialize_job(_row_to_dict(row))


def _run_cached_agent(
    conn: Any,
    *,
    agent_type: str,
    input_json: dict[str, Any],
    producer: Any,
    entity_id: Optional[str] = None,
    route_hash: Optional[str] = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    if agent_type not in AGENT_JOB_TYPES:
        raise ValueError(f"Unsupported agent_type: {agent_type}")
    ensure_agent_jobs_table(conn)
    input_hash = stable_input_hash(input_json)
    if not force_refresh:
        cached = _cached_completed_job(conn, agent_type, input_hash)
        if cached:
            return cached

    job_id = _insert_job(
        conn,
        agent_type=agent_type,
        input_hash=input_hash,
        input_json=input_json,
        entity_id=entity_id,
        route_hash=route_hash,
    )
    conn.commit()
    try:
        _mark_job_running(conn, job_id)
        conn.commit()
        output = producer(input_hash)
    except Exception as exc:
        return _fail_job(conn, job_id, str(exc))
    return _complete_job(conn, job_id, output)


def _coerce_float(value: Any) -> Optional[float]:
    if value in (None, "", " "):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(parsed) or math.isinf(parsed):
        return None
    return parsed


def _point(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        return {}
    return payload


def _lat_lng(point: Any) -> tuple[Optional[float], Optional[float]]:
    p = _point(point)
    return _coerce_float(p.get("lat")), _coerce_float(p.get("lng"))


def _metadata_country(point: Any) -> str:
    p = _point(point)
    meta = p.get("metadata") if isinstance(p.get("metadata"), dict) else {}
    return str(meta.get("country") or p.get("country") or "").strip()


def _norm(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _haversine_km(a_lat: float, a_lng: float, b_lat: float, b_lng: float) -> float:
    r_km = 6371.0
    d_lat = math.radians(b_lat - a_lat)
    d_lng = math.radians(b_lng - a_lng)
    aa = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(a_lat)) * math.cos(math.radians(b_lat)) * math.sin(d_lng / 2) ** 2
    )
    return 2 * r_km * math.atan2(math.sqrt(aa), math.sqrt(1 - aa))


def _leg_distance_km(leg: dict[str, Any]) -> Optional[float]:
    direct = _coerce_float(leg.get("distance_km") or leg.get("distanceKm"))
    if direct is not None:
        return direct
    path = leg.get("path")
    if not isinstance(path, list) or len(path) < 2:
        return None
    total = 0.0
    previous: Optional[tuple[float, float]] = None
    for item in path:
        if not isinstance(item, (list, tuple)) or len(item) < 2:
            continue
        lat = _coerce_float(item[0])
        lng = _coerce_float(item[1])
        if lat is None or lng is None:
            continue
        if previous is not None:
            total += _haversine_km(previous[0], previous[1], lat, lng)
        previous = (lat, lng)
    return total if total > 0 else None


def _extract_route_legs(route_payload: dict[str, Any]) -> list[dict[str, Any]]:
    route = route_payload.get("route") if isinstance(route_payload.get("route"), dict) else {}
    map_payload = route_payload.get("map") if isinstance(route_payload.get("map"), dict) else {}
    legs = route.get("legs") or map_payload.get("legs") or route_payload.get("legs")
    return [leg for leg in legs if isinstance(leg, dict)] if isinstance(legs, list) else []


def deterministic_route_warnings(route_payload: dict[str, Any]) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    legs = _extract_route_legs(route_payload)
    route = route_payload.get("route") if isinstance(route_payload.get("route"), dict) else {}

    if not legs:
        warnings.append(
            {
                "code": "route.missing_legs",
                "severity": "fail",
                "message": "Route response has no executable legs.",
                "evidence": {},
            }
        )

    if route_payload.get("source") == "simulation" or route_payload.get("liveUnavailableReason"):
        warnings.append(
            {
                "code": "route.simulation",
                "severity": "warn",
                "message": "Route was generated from simulation or a degraded live path.",
                "evidence": {"reason": route_payload.get("liveUnavailableReason")},
            }
        )

    origin_country = _metadata_country(route.get("origin"))
    destination_country = _metadata_country(route.get("destination"))

    for index, leg in enumerate(legs):
        method = _norm(leg.get("method"))
        from_point = leg.get("from") if isinstance(leg.get("from"), dict) else {}
        to_point = leg.get("to") if isinstance(leg.get("to"), dict) else {}
        geometry_source = _norm(leg.get("geometry_source") or leg.get("geometrySource"))
        distance_km = _leg_distance_km(leg)
        path = leg.get("path") if isinstance(leg.get("path"), list) else []

        for role, point in (("from", from_point), ("to", to_point)):
            lat, lng = _lat_lng(point)
            if lat is None or lng is None or not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
                warnings.append(
                    {
                        "code": "route.invalid_leg_coordinate",
                        "severity": "fail",
                        "message": f"Leg {index + 1} has invalid {role} coordinates.",
                        "evidence": {"leg_index": index, "role": role, "point": point},
                    }
                )

        if method == "sea":
            from_kind = _norm(from_point.get("kind"))
            to_kind = _norm(to_point.get("kind"))
            if from_kind not in {"port", "sea_lane"} or to_kind not in {"port", "sea_lane"}:
                warnings.append(
                    {
                        "code": "route.sea_endpoint_not_port",
                        "severity": "warn",
                        "message": "Sea leg endpoints are not both ports or sea-lane waypoints.",
                        "evidence": {"leg_index": index, "from_kind": from_kind, "to_kind": to_kind},
                    }
                )
            if len(path) < 3:
                warnings.append(
                    {
                        "code": "route.sea_path_too_sparse",
                        "severity": "warn",
                        "message": "Sea leg has too few geometry points for corridor sanity checking.",
                        "evidence": {"leg_index": index, "path_points": len(path)},
                    }
                )
            if geometry_source in {"straight_line", "straight_line_fallback", ""}:
                warnings.append(
                    {
                        "code": "route.sea_geometry_degraded",
                        "severity": "warn",
                        "message": "Sea leg is using straight-line or unknown geometry.",
                        "evidence": {"leg_index": index, "geometry_source": geometry_source or "unknown"},
                    }
                )

        if method in {"road", "truck", "truck_inland"}:
            from_country = _metadata_country(from_point)
            to_country = _metadata_country(to_point)
            if distance_km is not None and distance_km > 1500:
                warnings.append(
                    {
                        "code": "route.road_leg_very_long",
                        "severity": "warn",
                        "message": "Road leg is unusually long for a single trucking segment.",
                        "evidence": {"leg_index": index, "distance_km": round(distance_km, 1)},
                    }
                )
            if from_country and to_country and _norm(from_country) != _norm(to_country) and (distance_km or 0) > 800:
                warnings.append(
                    {
                        "code": "route.road_cross_country",
                        "severity": "warn",
                        "message": "Long road leg crosses declared country boundary; border/permit validation required.",
                        "evidence": {
                            "leg_index": index,
                            "from_country": from_country,
                            "to_country": to_country,
                            "distance_km": round(distance_km or 0, 1),
                        },
                    }
                )

    if origin_country and legs:
        first_from_country = _metadata_country(legs[0].get("from"))
        if first_from_country and _norm(first_from_country) != _norm(origin_country):
            warnings.append(
                {
                    "code": "route.origin_hub_mismatch",
                    "severity": "warn",
                    "message": "First route leg does not start in the declared origin country.",
                    "evidence": {"declared_origin_country": origin_country, "first_leg_country": first_from_country},
                }
            )
    if destination_country and legs:
        final_to_country = _metadata_country(legs[-1].get("to"))
        if final_to_country and _norm(final_to_country) != _norm(destination_country):
            warnings.append(
                {
                    "code": "route.destination_hub_mismatch",
                    "severity": "warn",
                    "message": "Final route leg does not end in the declared destination country.",
                    "evidence": {"declared_destination_country": destination_country, "final_leg_country": final_to_country},
                }
            )
    return warnings


def _severity_score(warnings: list[dict[str, Any]]) -> int:
    score = 100
    for warning in warnings:
        score -= 30 if warning.get("severity") == "fail" else 10
    return max(0, min(100, score))


def _bounded_json(payload: Any, max_chars: Optional[int] = None) -> str:
    limit = max_chars or int(os.getenv("AGENT_AI_MAX_INPUT_CHARS", "6000"))
    serialized = json.dumps(payload, sort_keys=True, ensure_ascii=True, default=_json_default)
    if len(serialized) <= limit:
        return serialized
    return serialized[:limit] + "...[truncated]"


def _extract_json_object(text: str) -> Optional[dict[str, Any]]:
    try:
        from backend.services.dd.orchestrator import _extract_json_object as parse_json
    except ImportError:
        from services.dd.orchestrator import _extract_json_object as parse_json  # type: ignore[no-redef]
    return parse_json(text)


def _run_bounded_ai_json(system_prompt: str, user_payload: dict[str, Any]) -> dict[str, Any]:
    try:
        from backend.services.dd.orchestrator import _run_provider_cascade
    except ImportError:
        from services.dd.orchestrator import _run_provider_cascade  # type: ignore[no-redef]

    result = _run_provider_cascade(system_prompt, _bounded_json(user_payload))
    if not result or not result.get("content"):
        return {"status": "skipped", "provider": None, "model": None, "parsed": None}
    parsed = _extract_json_object(result["content"]) or {}
    return {
        "status": "success" if parsed else "unparsed",
        "provider": result.get("provider"),
        "model": result.get("model"),
        "parsed": parsed if parsed else None,
    }


def run_route_intelligence(
    conn: Any,
    *,
    route_payload: dict[str, Any],
    deterministic_warnings: Optional[list[dict[str, Any]]] = None,
    route_hash: Optional[str] = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    route_input = build_route_intelligence_input(route_payload, deterministic_warnings)
    effective_route_hash = route_hash or stable_input_hash(route_payload)

    def produce(input_hash: str) -> dict[str, Any]:
        warnings = deterministic_route_warnings(route_payload)
        if deterministic_warnings:
            warnings.extend([item for item in deterministic_warnings if isinstance(item, dict)])
        score = _severity_score(warnings)
        ai_result = {"status": "skipped", "provider": None, "model": None, "parsed": None}
        if warnings:
            ai_result = _run_bounded_ai_json(
                (
                    "You are a route-risk analyst. Use only the provided route JSON and deterministic warnings. "
                    "Do not invent facts. Return JSON only: "
                    '{"risk_level":"low|medium|high","summary":"...","recommendations":["..."],"requires_human_review":true}'
                ),
                {"route": route_payload, "warnings": warnings},
            )
        parsed = ai_result.get("parsed") if isinstance(ai_result.get("parsed"), dict) else {}
        risk_level = parsed.get("risk_level") or ("high" if score < 60 else "medium" if warnings else "low")
        return {
            "agent": "route_intelligence",
            "input_hash": input_hash,
            "route_hash": effective_route_hash,
            "score": score,
            "risk_level": risk_level,
            "deterministic_warnings": warnings,
            "summary": parsed.get("summary") or (
                "Deterministic checks found route warnings." if warnings else "No deterministic route warnings found."
            ),
            "recommendations": parsed.get("recommendations")
            if isinstance(parsed.get("recommendations"), list)
            else _route_recommendations_from_warnings(warnings),
            "requires_human_review": bool(warnings) or bool(parsed.get("requires_human_review")),
            "ai": {
                "status": ai_result.get("status"),
                "provider": ai_result.get("provider"),
                "model": ai_result.get("model"),
                "bounded": True,
            },
            "token_saving": _token_saving_metadata(ai_enabled=bool(warnings)),
        }

    return _run_cached_agent(
        conn,
        agent_type="route_intelligence",
        input_json=route_input,
        producer=produce,
        route_hash=effective_route_hash,
        force_refresh=force_refresh,
    )


def build_route_intelligence_input(
    route_payload: dict[str, Any],
    deterministic_warnings: Optional[list[dict[str, Any]]] = None,
) -> dict[str, Any]:
    return {
        "route": route_payload,
        "deterministic_warnings": deterministic_warnings or [],
        "prompt_version": "route_intelligence_v1",
    }


def enqueue_route_intelligence(
    conn: Any,
    *,
    route_payload: dict[str, Any],
    deterministic_warnings: Optional[list[dict[str, Any]]] = None,
    route_hash: Optional[str] = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    effective_route_hash = route_hash or stable_input_hash(route_payload)
    return enqueue_agent_job(
        conn,
        agent_type="route_intelligence",
        input_json=build_route_intelligence_input(route_payload, deterministic_warnings),
        route_hash=effective_route_hash,
        force_refresh=force_refresh,
    )


def _route_recommendations_from_warnings(warnings: list[dict[str, Any]]) -> list[str]:
    if not warnings:
        return ["Proceed with normal broker/carrier validation before execution."]
    recs = []
    codes = {warning.get("code") for warning in warnings}
    if "route.sea_geometry_degraded" in codes or "route.sea_path_too_sparse" in codes:
        recs.append("Re-run with searoute enabled or validate the sea corridor with a freight forwarder.")
    if "route.road_leg_very_long" in codes or "route.road_cross_country" in codes:
        recs.append("Break long road segments into border/permit checkpoints before execution.")
    if "route.simulation" in codes:
        recs.append("Do not execute from a simulation result; rerun the live route first.")
    if not recs:
        recs.append("Review flagged route assumptions before committing cargo.")
    return recs


def _token_saving_metadata(*, ai_enabled: bool) -> dict[str, Any]:
    return {
        "deterministic_first": True,
        "ai_called": ai_enabled,
        "bounded_input_chars": int(os.getenv("AGENT_AI_MAX_INPUT_CHARS", "6000")),
        "cache_key": "agent_type + stable input_hash",
        "output_format": "small structured JSON",
    }


def _safe_json_load(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return None
    return None


def load_license_agent_row(conn: Any, entity_id: str) -> Optional[dict[str, Any]]:
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            SELECT id, company, country, region, commodity, license_type, status,
                   lat, lng, phone_number, contact_person, record_origin,
                   source_name, source_url, source_record_url, source_updated_at,
                   raw_payload, last_synced_at, sector, entity_kind, confidence_score,
                   confidence_note, geo_source, geo_approximated, geo_confidence
            FROM licenses
            WHERE id = %s
            """,
            (entity_id,),
        )
        row = cur.fetchone()
    if not row:
        return None
    data = _row_to_dict(row)
    data["raw_payload"] = _safe_json_load(data.get("raw_payload"))
    return data


def deterministic_entity_warnings(entity: dict[str, Any], relationships: Optional[list[dict[str, Any]]] = None) -> list[dict[str, Any]]:
    warnings: list[dict[str, Any]] = []
    entity_id = entity.get("id") or entity.get("entity_id")
    lat = _coerce_float(entity.get("lat"))
    lng = _coerce_float(entity.get("lng"))
    if lat is None or lng is None or (lat == 0 and lng == 0) or not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
        warnings.append(
            {
                "code": "entity.missing_coords",
                "severity": "warn",
                "message": "Entity coordinates are missing, invalid, or still set to the 0,0 placeholder.",
                "evidence": {"entity_id": entity_id, "lat": entity.get("lat"), "lng": entity.get("lng")},
            }
        )
    if not str(entity.get("company") or entity.get("name") or "").strip():
        warnings.append(
            {
                "code": "entity.missing_company",
                "severity": "fail",
                "message": "Entity is missing a company/license-holder name.",
                "evidence": {"entity_id": entity_id},
            }
        )
    if not str(entity.get("country") or "").strip():
        warnings.append(
            {
                "code": "entity.missing_country",
                "severity": "warn",
                "message": "Entity country is missing.",
                "evidence": {"entity_id": entity_id},
            }
        )

    operator_signals = [
        rel for rel in (relationships or []) if _norm(rel.get("relationship_type") or rel.get("relationshipType")) == "operator"
    ]
    raw_payload = entity.get("raw_payload")
    raw_text = json.dumps(raw_payload, ensure_ascii=True, default=_json_default).lower() if raw_payload else ""
    has_operator_in_source = bool(operator_signals) or "operator" in raw_text or bool(entity.get("operatorName"))
    if not has_operator_in_source:
        warnings.append(
            {
                "code": "entity.missing_operator",
                "severity": "warn",
                "message": "No source-backed mine/operator field was found.",
                "evidence": {"entity_id": entity_id},
            }
        )

    source_url = str(entity.get("source_record_url") or entity.get("source_url") or "").strip()
    source_name = str(entity.get("source_name") or "").strip()
    if not source_url and not source_name:
        warnings.append(
            {
                "code": "entity.source_missing",
                "severity": "warn",
                "message": "No source URL or source name is attached to the record.",
                "evidence": {"entity_id": entity_id, "record_origin": entity.get("record_origin")},
            }
        )
    elif source_url and not URL_RE.match(source_url):
        warnings.append(
            {
                "code": "entity.source_url_invalid",
                "severity": "warn",
                "message": "Source URL is not an http(s) URL.",
                "evidence": {"entity_id": entity_id, "source_url": source_url},
            }
        )
    return warnings


def _serialize_contact_candidate(candidate: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": candidate.get("id"),
        "entityKind": candidate.get("entity_kind"),
        "entityId": candidate.get("entity_id"),
        "contactType": candidate.get("contact_type"),
        "contactScope": candidate.get("contact_scope"),
        "label": candidate.get("label"),
        "value": candidate.get("value"),
        "sourceName": candidate.get("source_name"),
        "sourceUrl": candidate.get("source_url"),
        "sourceType": candidate.get("source_type"),
        "confidenceScore": candidate.get("confidence_score"),
        "rawPayload": candidate.get("raw_payload"),
        "extractedFrom": candidate.get("extracted_from"),
        "discoveredBy": candidate.get("discovered_by") or "open_data",
        "verifiedAt": candidate.get("verified_at"),
    }


def run_contact_enrichment(
    conn: Any,
    *,
    entity_id: str,
    entity_kind: str = "license",
    entity: Optional[dict[str, Any]] = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    loaded = load_license_agent_row(conn, entity_id) if entity_kind == "license" else None
    source_entity = loaded or entity or {"id": entity_id, "entity_kind": entity_kind}
    input_json = build_contact_enrichment_input(entity_id, entity_kind, source_entity)

    def produce(input_hash: str) -> dict[str, Any]:
        if entity_kind != "license" or loaded is None:
            contacts: list[dict[str, Any]] = []
        else:
            contacts = build_license_contact_candidates(loaded)
            for contact in contacts:
                contact.setdefault("discovered_by", "open_data")
            if contacts:
                upsert_entity_contact_candidates(conn, contacts)
        found_types = {contact.get("contact_type") for contact in contacts}
        missing = [kind for kind in ("phone", "email", "website") if kind not in found_types]
        return {
            "agent": "contact_enrichment",
            "input_hash": input_hash,
            "entity_id": entity_id,
            "entity_kind": entity_kind,
            "status": "completed",
            "contacts": [_serialize_contact_candidate(contact) for contact in sorted(
                contacts,
                key=lambda item: (CONTACT_TYPE_ORDER.get(item.get("contact_type"), 99), -(item.get("confidence_score") or 0)),
            )],
            "not_found": missing,
            "limitations": [
                "No backend web-search connector is configured for this agent.",
                "Only explicit phone/email/website/address fields in known source data are returned.",
                "Missing contacts are reported as not found rather than guessed.",
            ],
            "ai": {"status": "not_used", "reason": "contact agent is source-extraction only until web search infra exists"},
            "token_saving": _token_saving_metadata(ai_enabled=False),
        }

    return _run_cached_agent(
        conn,
        agent_type="contact_enrichment",
        input_json=input_json,
        producer=produce,
        entity_id=entity_id,
        force_refresh=force_refresh,
    )


def build_contact_enrichment_input(entity_id: str, entity_kind: str, source_entity: dict[str, Any]) -> dict[str, Any]:
    return {
        "entity_id": entity_id,
        "entity_kind": entity_kind,
        "entity": _compact_entity_for_input(source_entity),
        "agent_version": "contact_enrichment_v1",
    }


def enqueue_contact_enrichment(
    conn: Any,
    *,
    entity_id: str,
    entity_kind: str = "license",
    entity: Optional[dict[str, Any]] = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    loaded = load_license_agent_row(conn, entity_id) if entity_kind == "license" else None
    source_entity = loaded or entity or {"id": entity_id, "entity_kind": entity_kind}
    return enqueue_agent_job(
        conn,
        agent_type="contact_enrichment",
        input_json=build_contact_enrichment_input(entity_id, entity_kind, source_entity),
        entity_id=entity_id,
        force_refresh=force_refresh,
    )


def _compact_entity_for_input(entity: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": entity.get("id"),
        "company": entity.get("company") or entity.get("name"),
        "country": entity.get("country"),
        "region": entity.get("region"),
        "commodity": entity.get("commodity"),
        "license_type": entity.get("license_type") or entity.get("licenseType"),
        "status": entity.get("status"),
        "source_name": entity.get("source_name") or entity.get("sourceName"),
        "source_url": entity.get("source_record_url") or entity.get("sourceRecordUrl") or entity.get("source_url") or entity.get("sourceUrl"),
        "record_origin": entity.get("record_origin") or entity.get("recordOrigin"),
    }


def _serialize_relationship(candidate: dict[str, Any]) -> dict[str, Any]:
    return {
        "relationshipType": candidate.get("relationship_type") or candidate.get("relationshipType"),
        "targetName": candidate.get("target_name") or candidate.get("targetName"),
        "sourceName": candidate.get("source_name") or candidate.get("sourceName"),
        "sourceUrl": candidate.get("source_url") or candidate.get("sourceUrl"),
        "confidenceScore": candidate.get("confidence_score") or candidate.get("confidenceScore"),
        "extractedFrom": candidate.get("extracted_from") or candidate.get("extractedFrom"),
    }


def deterministic_operator_validation(entity: dict[str, Any], relationships: list[dict[str, Any]]) -> dict[str, Any]:
    company = str(entity.get("company") or entity.get("name") or "").strip()
    holders = [
        rel for rel in relationships if _norm(rel.get("relationship_type") or rel.get("relationshipType")) == "license_holder"
    ]
    operators = [
        rel for rel in relationships if _norm(rel.get("relationship_type") or rel.get("relationshipType")) == "operator"
    ]
    holder_names = [str(rel.get("target_name") or rel.get("targetName") or "").strip() for rel in holders if rel.get("target_name") or rel.get("targetName")]
    operator_names = [str(rel.get("target_name") or rel.get("targetName") or "").strip() for rel in operators if rel.get("target_name") or rel.get("targetName")]

    findings: list[dict[str, Any]] = []
    if not company:
        findings.append({"severity": "fail", "code": "operator.company_missing", "message": "Company/license-holder name is missing."})
    if not holder_names and company:
        holder_names = [company]
        findings.append({"severity": "warn", "code": "operator.holder_fallback", "message": "Using licenses.company as the license-holder fallback."})
    if not operator_names:
        findings.append({"severity": "warn", "code": "operator.missing", "message": "No explicit operator field was found in source-backed data."})
    elif holder_names:
        holder_norms = {_norm(name) for name in holder_names}
        operator_norms = {_norm(name) for name in operator_names}
        if holder_norms & operator_norms:
            findings.append({"severity": "pass", "code": "operator.matches_holder", "message": "Operator matches at least one license-holder signal."})
        else:
            findings.append(
                {
                    "severity": "warn",
                    "code": "operator.differs_from_holder",
                    "message": "Operator differs from the recorded license holder; verify operating rights.",
                    "evidence": {"holders": holder_names, "operators": operator_names},
                }
            )

    score = _severity_score([finding for finding in findings if finding.get("severity") in {"warn", "fail"}])
    return {
        "holder_names": holder_names,
        "operator_names": operator_names,
        "findings": findings,
        "score": score,
        "recommendation": "approve" if score >= 90 else "review" if score >= 60 else "block",
        "confidence": max(0.35, min(0.95, score / 100)),
    }


def run_operator_validation(
    conn: Any,
    *,
    entity_id: str,
    entity_kind: str = "license",
    entity: Optional[dict[str, Any]] = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    loaded = load_license_agent_row(conn, entity_id) if entity_kind == "license" else None
    source_entity = loaded or entity or {"id": entity_id, "entity_kind": entity_kind}
    relationships = build_license_relationship_candidates(loaded) if loaded is not None else []
    input_json = build_operator_validation_input(entity_id, entity_kind, source_entity, relationships)

    def produce(input_hash: str) -> dict[str, Any]:
        validation = deterministic_operator_validation(source_entity, relationships)
        ai_result = {"status": "skipped", "provider": None, "model": None, "parsed": None}
        has_conflict = any(finding.get("severity") in {"warn", "fail"} for finding in validation["findings"])
        if has_conflict:
            ai_result = _run_bounded_ai_json(
                (
                    "You summarize mine operator validation conflicts. Use only the provided holder/operator evidence. "
                    "Do not add outside facts. Return JSON only: "
                    '{"summary":"...","next_steps":["..."],"confidence_note":"..."}'
                ),
                {"entity": _compact_entity_for_input(source_entity), "validation": validation},
            )
        parsed = ai_result.get("parsed") if isinstance(ai_result.get("parsed"), dict) else {}
        return {
            "agent": "operator_validation",
            "input_hash": input_hash,
            "entity_id": entity_id,
            "entity_kind": entity_kind,
            **validation,
            "relationships": [_serialize_relationship(rel) for rel in relationships],
            "summary": parsed.get("summary") or "Operator validation completed from source-backed fields.",
            "next_steps": parsed.get("next_steps") if isinstance(parsed.get("next_steps"), list) else _operator_next_steps(validation),
            "confidence_note": parsed.get("confidence_note") or "Confidence is based on explicit holder/operator fields and source provenance.",
            "ai": {
                "status": ai_result.get("status"),
                "provider": ai_result.get("provider"),
                "model": ai_result.get("model"),
                "bounded": True,
            },
            "token_saving": _token_saving_metadata(ai_enabled=has_conflict),
        }

    return _run_cached_agent(
        conn,
        agent_type="operator_validation",
        input_json=input_json,
        producer=produce,
        entity_id=entity_id,
        force_refresh=force_refresh,
    )


def build_operator_validation_input(
    entity_id: str,
    entity_kind: str,
    source_entity: dict[str, Any],
    relationships: list[dict[str, Any]],
) -> dict[str, Any]:
    return {
        "entity_id": entity_id,
        "entity_kind": entity_kind,
        "entity": _compact_entity_for_input(source_entity),
        "relationships": [_serialize_relationship(rel) for rel in relationships],
        "agent_version": "operator_validation_v1",
    }


def enqueue_operator_validation(
    conn: Any,
    *,
    entity_id: str,
    entity_kind: str = "license",
    entity: Optional[dict[str, Any]] = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    loaded = load_license_agent_row(conn, entity_id) if entity_kind == "license" else None
    source_entity = loaded or entity or {"id": entity_id, "entity_kind": entity_kind}
    relationships = build_license_relationship_candidates(loaded) if loaded is not None else []
    return enqueue_agent_job(
        conn,
        agent_type="operator_validation",
        input_json=build_operator_validation_input(entity_id, entity_kind, source_entity, relationships),
        entity_id=entity_id,
        force_refresh=force_refresh,
    )


def _operator_next_steps(validation: dict[str, Any]) -> list[str]:
    codes = {finding.get("code") for finding in validation.get("findings", [])}
    if "operator.missing" in codes:
        return ["Check the official registry record or concession filing for an explicit operator/manager field."]
    if "operator.differs_from_holder" in codes:
        return ["Request the operating agreement or mine-management authority evidence before relying on the operator name."]
    return ["No extra operator validation step was generated."]


def run_entity_data_validation(
    conn: Any,
    *,
    entity_id: str,
    entity_kind: str = "license",
    force_refresh: bool = False,
) -> dict[str, Any]:
    loaded = load_license_agent_row(conn, entity_id) if entity_kind == "license" else None
    if loaded is None:
        source_entity = {"id": entity_id, "entity_kind": entity_kind}
        relationships: list[dict[str, Any]] = []
    else:
        source_entity = loaded
        relationships = build_license_relationship_candidates(loaded)
    input_json = {
        "entity_id": entity_id,
        "entity_kind": entity_kind,
        "entity": _compact_entity_for_input(source_entity),
        "agent_version": "data_validation_v1",
    }

    def produce(input_hash: str) -> dict[str, Any]:
        warnings = deterministic_entity_warnings(source_entity, relationships)
        score = _severity_score(warnings)
        return {
            "agent": "data_validation",
            "input_hash": input_hash,
            "entity_id": entity_id,
            "entity_kind": entity_kind,
            "score": score,
            "status": "suspicious" if warnings else "clean",
            "warnings": warnings,
            "ai": {"status": "not_used", "reason": "entity validation MVP is deterministic only"},
            "token_saving": _token_saving_metadata(ai_enabled=False),
        }

    return _run_cached_agent(
        conn,
        agent_type="data_validation",
        input_json=input_json,
        producer=produce,
        entity_id=entity_id,
        force_refresh=force_refresh,
    )


def run_data_validation_batch(conn: Any, *, limit: int = 25, force_refresh: bool = False) -> dict[str, Any]:
    bounded_limit = max(1, min(int(limit or 25), 100))
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            SELECT id
            FROM licenses
            ORDER BY
                CASE WHEN lat IS NULL OR lng IS NULL OR (lat = 0 AND lng = 0) THEN 0 ELSE 1 END,
                confidence_score ASC NULLS FIRST,
                id ASC
            LIMIT %s
            """,
            (bounded_limit,),
        )
        ids = [str((_row_to_dict(row).get("id") if hasattr(row, "keys") else row[0])) for row in cur.fetchall()]
    input_json = {"limit": bounded_limit, "entity_ids": ids, "agent_version": "data_validation_batch_v1"}

    def produce(input_hash: str) -> dict[str, Any]:
        results = [
            run_entity_data_validation(conn, entity_id=entity_id, force_refresh=force_refresh).get("output")
            for entity_id in ids
        ]
        suspicious = [result for result in results if isinstance(result, dict) and result.get("status") == "suspicious"]
        return {
            "agent": "data_validation",
            "input_hash": input_hash,
            "limit": bounded_limit,
            "checked_count": len(results),
            "suspicious_count": len(suspicious),
            "results": results,
            "ai": {"status": "not_used", "reason": "batch validation is deterministic only"},
            "token_saving": _token_saving_metadata(ai_enabled=False),
        }

    return _run_cached_agent(
        conn,
        agent_type="data_validation",
        input_json=input_json,
        producer=produce,
        force_refresh=force_refresh,
    )
