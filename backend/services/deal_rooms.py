from __future__ import annotations

import json
import uuid
from datetime import datetime
from typing import Any, Optional

try:
    from psycopg2.extras import Json, RealDictCursor
except ImportError:  # pragma: no cover
    RealDictCursor = None

    def Json(value: Any) -> Any:
        return value

try:
    from backend.services.agent_intelligence import (
        _run_cached_agent,
        _token_saving_metadata,
        enqueue_agent_job,
        get_agent_job,
        stable_input_hash,
    )
except ImportError:
    from services.agent_intelligence import (  # type: ignore[no-redef]
        _run_cached_agent,
        _token_saving_metadata,
        enqueue_agent_job,
        get_agent_job,
        stable_input_hash,
    )


def _json_default(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


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


def _safe_json(value: Any, default: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return default
    return default


ARCHIVED_STATUS = "archived"


def ensure_deal_rooms_table(conn: Any) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS deal_rooms (
                id VARCHAR(255) PRIMARY KEY,
                title TEXT NOT NULL,
                entity_id VARCHAR(255) NOT NULL,
                entity_kind VARCHAR(50) NOT NULL DEFAULT 'license',
                status VARCHAR(50) NOT NULL DEFAULT 'open',
                route_snapshot_json JSONB,
                agent_job_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
                evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_deal_rooms_entity_updated
            ON deal_rooms (entity_kind, entity_id, updated_at DESC);
            """
        )
        cur.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_deal_rooms_status_updated
            ON deal_rooms (status, updated_at DESC);
            """
        )


def serialize_deal_room(row: dict[str, Any]) -> dict[str, Any]:
    route_snapshot = _safe_json(row.get("route_snapshot_json"), None)
    agent_job_ids = _safe_json(row.get("agent_job_ids_json"), [])
    evidence = _safe_json(row.get("evidence_json"), {})
    return {
        "id": row.get("id"),
        "title": row.get("title"),
        "entityId": row.get("entity_id"),
        "entityKind": row.get("entity_kind"),
        "status": row.get("status"),
        "routeSnapshot": route_snapshot,
        "agentJobIds": agent_job_ids if isinstance(agent_job_ids, list) else [],
        "evidence": evidence if isinstance(evidence, dict) else {},
        "notes": row.get("notes"),
        "createdAt": row.get("created_at"),
        "updatedAt": row.get("updated_at"),
    }


def load_entity_basics(conn: Any, entity_id: str, entity_kind: str = "license") -> dict[str, Any]:
    if entity_kind != "license":
        return {"id": entity_id, "entityKind": entity_kind}
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            SELECT id, company, country, region, commodity, license_type, status,
                   lat, lng, sector, entity_kind, source_name, source_url,
                   source_record_url, confidence_score, confidence_note
            FROM licenses
            WHERE id = %s
            """,
            (entity_id,),
        )
        row = cur.fetchone()
    if not row:
        return {"id": entity_id, "entityKind": entity_kind}
    data = _row_to_dict(row)
    return {
        "id": data.get("id"),
        "entityKind": data.get("entity_kind") or entity_kind,
        "company": data.get("company"),
        "country": data.get("country"),
        "region": data.get("region"),
        "commodity": data.get("commodity"),
        "licenseType": data.get("license_type"),
        "status": data.get("status"),
        "lat": data.get("lat"),
        "lng": data.get("lng"),
        "sector": data.get("sector") or "mining",
        "sourceName": data.get("source_name"),
        "sourceUrl": data.get("source_record_url") or data.get("source_url"),
        "confidenceScore": data.get("confidence_score"),
        "confidenceNote": data.get("confidence_note"),
    }


def create_deal_room(
    conn: Any,
    *,
    entity_id: str,
    entity_kind: str = "license",
    title: Optional[str] = None,
    status: str = "open",
    route_snapshot: Optional[dict[str, Any]] = None,
    notes: Optional[str] = None,
    rfq: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    ensure_deal_rooms_table(conn)
    entity = load_entity_basics(conn, entity_id, entity_kind)
    deal_room_id = str(uuid.uuid4())
    default_title = f"{entity.get('company') or entity_id} Investigation"
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            INSERT INTO deal_rooms (
                id, title, entity_id, entity_kind, status, route_snapshot_json,
                agent_job_ids_json, evidence_json, notes, updated_at
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
            RETURNING id, title, entity_id, entity_kind, status, route_snapshot_json,
                      agent_job_ids_json, evidence_json, notes, created_at, updated_at
            """,
            (
                deal_room_id,
                title or default_title,
                entity_id,
                entity_kind,
                status,
                _jsonb(route_snapshot) if route_snapshot is not None else None,
                _jsonb([]),
                _jsonb({"entity": entity, "agentOutputs": {}, "confidence": None, "rfq": rfq or {}}),
                notes,
            ),
        )
        row = cur.fetchone()
    conn.commit()
    return serialize_deal_room(_row_to_dict(row))


def list_deal_rooms(
    conn: Any,
    *,
    entity_id: Optional[str] = None,
    entity_kind: Optional[str] = None,
    include_archived: bool = False,
) -> list[dict[str, Any]]:
    ensure_deal_rooms_table(conn)
    where = []
    params: list[Any] = []
    if not include_archived:
        where.append("status <> %s")
        params.append(ARCHIVED_STATUS)
    if entity_id:
        where.append("entity_id = %s")
        params.append(entity_id)
    if entity_kind:
        where.append("entity_kind = %s")
        params.append(entity_kind)
    sql_where = f"WHERE {' AND '.join(where)}" if where else ""
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            f"""
            SELECT id, title, entity_id, entity_kind, status, route_snapshot_json,
                   agent_job_ids_json, evidence_json, notes, created_at, updated_at
            FROM deal_rooms
            {sql_where}
            ORDER BY updated_at DESC
            LIMIT 100
            """,
            tuple(params),
        )
        rows = cur.fetchall()
    return [serialize_deal_room(_row_to_dict(row)) for row in rows]


def get_deal_room(conn: Any, deal_room_id: str) -> Optional[dict[str, Any]]:
    ensure_deal_rooms_table(conn)
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            SELECT id, title, entity_id, entity_kind, status, route_snapshot_json,
                   agent_job_ids_json, evidence_json, notes, created_at, updated_at
            FROM deal_rooms
            WHERE id = %s
            """,
            (deal_room_id,),
        )
        row = cur.fetchone()
    return serialize_deal_room(_row_to_dict(row)) if row else None


def update_deal_room(
    conn: Any,
    deal_room_id: str,
    *,
    title: Optional[str] = None,
    status: Optional[str] = None,
    route_snapshot: Any = None,
    evidence: Any = None,
    notes: Optional[str] = None,
) -> Optional[dict[str, Any]]:
    ensure_deal_rooms_table(conn)
    current = get_deal_room(conn, deal_room_id)
    if current is None:
        return None
    next_route = current.get("routeSnapshot") if route_snapshot is None else route_snapshot
    next_evidence = current.get("evidence") if evidence is None else evidence
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            UPDATE deal_rooms
            SET title = COALESCE(%s, title),
                status = COALESCE(%s, status),
                route_snapshot_json = %s,
                evidence_json = %s,
                notes = COALESCE(%s, notes),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
            RETURNING id, title, entity_id, entity_kind, status, route_snapshot_json,
                      agent_job_ids_json, evidence_json, notes, created_at, updated_at
            """,
            (
                title,
                status,
                _jsonb(next_route) if next_route is not None else None,
                _jsonb(next_evidence or {}),
                notes,
                deal_room_id,
            ),
        )
        row = cur.fetchone()
    conn.commit()
    return serialize_deal_room(_row_to_dict(row)) if row else None


def attach_agent_jobs(conn: Any, deal_room_id: str, jobs: list[dict[str, Any]]) -> Optional[dict[str, Any]]:
    room = get_deal_room(conn, deal_room_id)
    if room is None:
        return None
    existing = [str(job_id) for job_id in room.get("agentJobIds", []) if job_id]
    for job in jobs:
        job_id = job.get("job_id")
        if job_id and job_id not in existing:
            existing.append(job_id)
    evidence = dict(room.get("evidence") or {})
    evidence["agentOutputs"] = evidence.get("agentOutputs") or {}
    for job in jobs:
        if job.get("output"):
            evidence["agentOutputs"][job.get("agent_type") or job.get("agentType")] = job.get("output")
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            UPDATE deal_rooms
            SET agent_job_ids_json = %s,
                evidence_json = %s,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = %s
            RETURNING id, title, entity_id, entity_kind, status, route_snapshot_json,
                      agent_job_ids_json, evidence_json, notes, created_at, updated_at
            """,
            (_jsonb(existing), _jsonb(evidence), deal_room_id),
        )
        row = cur.fetchone()
    conn.commit()
    return serialize_deal_room(_row_to_dict(row)) if row else None


def build_due_diligence_summary_input(entity_id: str, entity_kind: str, latest_report: Optional[dict[str, Any]]) -> dict[str, Any]:
    return {
        "entity_id": entity_id,
        "entity_kind": entity_kind,
        "latest_report_id": latest_report.get("id") if latest_report else None,
        "latest_report_created_at": latest_report.get("created_at") if latest_report else None,
        "agent_version": "due_diligence_summary_v1",
    }


def _latest_dd_report(conn: Any, entity_id: str, entity_kind: str) -> Optional[dict[str, Any]]:
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            SELECT id, status, provider, model, analysis_text, extracted_contacts,
                   promoted_contacts, legal_events, discovered_phones, created_at
            FROM dd_reports
            WHERE entity_kind = %s AND entity_id = %s
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (entity_kind, entity_id),
        )
        row = cur.fetchone()
    return _row_to_dict(row) if row else None


def run_due_diligence_summary(
    conn: Any,
    *,
    entity_id: str,
    entity_kind: str = "license",
    force_refresh: bool = False,
) -> dict[str, Any]:
    latest = _latest_dd_report(conn, entity_id, entity_kind)
    input_json = build_due_diligence_summary_input(entity_id, entity_kind, latest)

    def produce(input_hash: str) -> dict[str, Any]:
        row = latest or {}
        analysis = str(row.get("analysis_text") or "").strip()
        legal_events = _safe_json(row.get("legal_events"), [])
        contacts = _safe_json(row.get("promoted_contacts"), [])
        discovered_phones = _safe_json(row.get("discovered_phones"), [])
        available = bool(row)
        confidence = 0.72 if available else 0.35
        return {
            "agent": "due_diligence_summary",
            "input_hash": input_hash,
            "entity_id": entity_id,
            "entity_kind": entity_kind,
            "status": "available" if available else "missing",
            "summary": analysis[:900] if analysis else "No persisted DD report is available yet.",
            "report_id": row.get("id"),
            "provider": row.get("provider"),
            "model": row.get("model"),
            "created_at": row.get("created_at"),
            "evidence": [
                {"type": "dd_report", "id": row.get("id"), "created_at": row.get("created_at")}
            ] if available else [],
            "contacts_count": len(contacts) if isinstance(contacts, list) else 0,
            "legal_events_count": len(legal_events) if isinstance(legal_events, list) else 0,
            "discovered_phones_count": len(discovered_phones) if isinstance(discovered_phones, list) else 0,
            "confidence": confidence,
            "risks": [
                "No persisted due-diligence report has been run for this entity."
            ] if not available else [],
            "token_saving": _token_saving_metadata(ai_enabled=False),
        }

    return _run_cached_agent(
        conn,
        agent_type="due_diligence_summary",
        input_json=input_json,
        producer=produce,
        entity_id=entity_id,
        force_refresh=force_refresh,
    )


def enqueue_due_diligence_summary(
    conn: Any,
    *,
    entity_id: str,
    entity_kind: str = "license",
    force_refresh: bool = False,
) -> dict[str, Any]:
    latest = _latest_dd_report(conn, entity_id, entity_kind)
    return enqueue_agent_job(
        conn,
        agent_type="due_diligence_summary",
        input_json=build_due_diligence_summary_input(entity_id, entity_kind, latest),
        entity_id=entity_id,
        force_refresh=force_refresh,
    )


def build_procurement_summary_input(entity: dict[str, Any]) -> dict[str, Any]:
    return {
        "entity_id": entity.get("id"),
        "entity_kind": entity.get("entityKind") or entity.get("entity_kind") or "license",
        "company": entity.get("company") or entity.get("name"),
        "country": entity.get("country"),
        "agent_version": "procurement_summary_v1",
    }


def run_procurement_summary(
    conn: Any,
    *,
    entity_id: str,
    entity_kind: str = "license",
    entity: Optional[dict[str, Any]] = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    source_entity = entity or load_entity_basics(conn, entity_id, entity_kind)
    input_json = build_procurement_summary_input(source_entity)

    def produce(input_hash: str) -> dict[str, Any]:
        company = str(source_entity.get("company") or source_entity.get("name") or "").strip()
        if not company:
            return {
                "agent": "procurement_summary",
                "input_hash": input_hash,
                "entity_id": entity_id,
                "status": "missing_company",
                "summary": {"totalAwardedUsd": 0, "activeContractCount": 0, "awardCount": 0},
                "awards": [],
                "confidence": 0.25,
                "risks": ["Company name is required to query procurement awards."],
                "token_saving": _token_saving_metadata(ai_enabled=False),
            }
        try:
            try:
                from backend.services.gov_procurement_store import (
                    collect_gov_procurement_from_db,
                    ensure_gov_procurement_tables,
                )
                from backend.services.gov_procurement_intel import serialize_gov_procurement_response
            except ImportError:
                from services.gov_procurement_store import (  # type: ignore[no-redef]
                    collect_gov_procurement_from_db,
                    ensure_gov_procurement_tables,
                )
                from services.gov_procurement_intel import serialize_gov_procurement_response  # type: ignore[no-redef]

            ensure_gov_procurement_tables(conn)
            payload = collect_gov_procurement_from_db(
                conn,
                company_name=company,
                country=source_entity.get("country"),
                limit=25,
            )
            serialized = serialize_gov_procurement_response(payload)
            summary = serialized.get("summary") if isinstance(serialized.get("summary"), dict) else {}
            awards = serialized.get("awards") if isinstance(serialized.get("awards"), list) else []
            total = summary.get("totalAwardedUsd") or summary.get("total_awarded_usd") or 0
            return {
                "agent": "procurement_summary",
                "input_hash": input_hash,
                "entity_id": entity_id,
                "status": "completed",
                "source": serialized.get("source"),
                "summary": summary,
                "awards": awards[:5],
                "warnings": serialized.get("warnings") or [],
                "limitations": serialized.get("limitations") or [],
                "confidence": 0.72 if awards else 0.45,
                "evidence": [
                    {
                        "type": "gov_procurement_award",
                        "awardId": award.get("id") or award.get("awardId"),
                        "sourceUrl": award.get("sourceUrl"),
                        "value": award.get("value"),
                    }
                    for award in awards[:5]
                    if isinstance(award, dict)
                ],
                "risks": [] if total else ["No matching procurement awards found in the local database."],
                "token_saving": _token_saving_metadata(ai_enabled=False),
            }
        except Exception as exc:
            return {
                "agent": "procurement_summary",
                "input_hash": input_hash,
                "entity_id": entity_id,
                "status": "unavailable",
                "summary": {"totalAwardedUsd": 0, "activeContractCount": 0, "awardCount": 0},
                "awards": [],
                "confidence": 0.3,
                "risks": [f"Procurement summary unavailable: {str(exc)[:240]}"],
                "token_saving": _token_saving_metadata(ai_enabled=False),
            }

    return _run_cached_agent(
        conn,
        agent_type="procurement_summary",
        input_json=input_json,
        producer=produce,
        entity_id=entity_id,
        force_refresh=force_refresh,
    )


def enqueue_procurement_summary(
    conn: Any,
    *,
    entity_id: str,
    entity_kind: str = "license",
    entity: Optional[dict[str, Any]] = None,
    force_refresh: bool = False,
) -> dict[str, Any]:
    source_entity = entity or load_entity_basics(conn, entity_id, entity_kind)
    return enqueue_agent_job(
        conn,
        agent_type="procurement_summary",
        input_json=build_procurement_summary_input(source_entity),
        entity_id=entity_id,
        force_refresh=force_refresh,
    )


def get_deal_room_jobs(conn: Any, room: dict[str, Any]) -> list[dict[str, Any]]:
    jobs: list[dict[str, Any]] = []
    for job_id in room.get("agentJobIds", []) or []:
        job = get_agent_job(conn, str(job_id))
        if job:
            jobs.append(job)
    return jobs


def update_deal_room_evidence_from_job(conn: Any, deal_room_id: str, job: dict[str, Any]) -> None:
    room = get_deal_room(conn, deal_room_id)
    if not room:
        return
    evidence = dict(room.get("evidence") or {})
    agent_outputs = dict(evidence.get("agentOutputs") or {})
    if job.get("output"):
        agent_outputs[str(job.get("agent_type"))] = job.get("output")
    evidence["agentOutputs"] = agent_outputs
    confidence_values = _confidence_values(list(agent_outputs.values()))
    evidence["confidence"] = round(sum(confidence_values) / len(confidence_values), 2) if confidence_values else None
    update_deal_room(conn, deal_room_id, evidence=evidence)


def build_export_package(conn: Any, deal_room_id: str) -> Optional[dict[str, Any]]:
    room = get_deal_room(conn, deal_room_id)
    if not room:
        return None
    entity = load_entity_basics(conn, room["entityId"], room.get("entityKind") or "license")
    jobs = get_deal_room_jobs(conn, room)
    outputs = {
        str(job.get("agent_type")): job.get("output")
        for job in jobs
        if job.get("status") == "completed" and isinstance(job.get("output"), dict)
    }
    route_snapshot = room.get("routeSnapshot")
    route_summary = _route_summary(route_snapshot, outputs.get("route_intelligence"))
    procurement = outputs.get("procurement_summary") or {}
    risks = _collect_risks(outputs, route_snapshot)
    confidence_values = _confidence_values(list(outputs.values()))
    if isinstance(entity.get("confidenceScore"), (int, float)):
        confidence_values.append(float(entity["confidenceScore"]))
    confidence = round(sum(confidence_values) / len(confidence_values), 2) if confidence_values else None
    procurement_enrichment: dict[str, Any] = {}
    try:
        try:
            from backend.services.deal_room_export_enrichment import enrich_deal_room_export
        except ImportError:
            from services.deal_room_export_enrichment import enrich_deal_room_export  # type: ignore[no-redef]

        procurement_enrichment = enrich_deal_room_export(conn, room=room, entity=entity)
    except Exception as exc:
        procurement_enrichment = {
            "relatedUsaAwards": [],
            "relatedEuNotices": [],
            "relatedProcurementWarnings": [f"Procurement enrichment skipped: {str(exc)[:200]}"],
        }

    package = {
        "dealRoom": room,
        "entity": entity,
        "routeSummary": route_summary,
        "agentJobs": jobs,
        "agentOutputs": outputs,
        "evidence": room.get("evidence") or {},
        "procurementAwardsSummary": procurement.get("summary") or {},
        "procurementAwards": procurement.get("awards") or [],
        "relatedUsaAwards": procurement_enrichment.get("relatedUsaAwards") or [],
        "relatedEuNotices": procurement_enrichment.get("relatedEuNotices") or [],
        "relatedProcurementWarnings": procurement_enrichment.get("relatedProcurementWarnings") or [],
        "partyNamesQueried": procurement_enrichment.get("partyNamesQueried") or [],
        "risks": risks,
        "confidence": confidence,
        "decision": _decision_from_risks_and_confidence(risks, confidence),
        "exportedAt": datetime.utcnow().isoformat() + "Z",
    }
    package["markdown"] = render_decision_package_markdown(package)
    return package


def _route_summary(route_snapshot: Any, route_output: Any) -> dict[str, Any]:
    if not isinstance(route_snapshot, dict):
        return {"status": "missing", "summary": "No route has been attached."}
    result = route_snapshot.get("result") if isinstance(route_snapshot.get("result"), dict) else route_snapshot
    breakdown = result.get("breakdown") if isinstance(result.get("breakdown"), list) else []
    total = sum(float(item.get("amountUsd") or 0) for item in breakdown if isinstance(item, dict))
    return {
        "status": "attached",
        "source": result.get("source"),
        "totalCostUsd": round(total, 2),
        "recommendation": result.get("dueDiligenceRecommendation"),
        "warnings": result.get("warnings") or [],
        "blockers": result.get("blockers") or [],
        "risk": route_output if isinstance(route_output, dict) else None,
    }


def _confidence_values(outputs: list[Any]) -> list[float]:
    values: list[float] = []
    for output in outputs:
        if not isinstance(output, dict):
            continue
        confidence = output.get("confidence")
        if isinstance(confidence, (int, float)):
            values.append(max(0.0, min(1.0, float(confidence))))
        score = output.get("score")
        if isinstance(score, (int, float)):
            values.append(max(0.0, min(1.0, float(score) / 100.0)))
    return values


def _collect_risks(outputs: dict[str, Any], route_snapshot: Any) -> list[str]:
    risks: list[str] = []
    if not route_snapshot:
        risks.append("No route snapshot attached.")
    for output in outputs.values():
        if not isinstance(output, dict):
            continue
        for key in ("risks", "warnings", "limitations"):
            items = output.get(key)
            if isinstance(items, list):
                risks.extend(str(item) for item in items[:5] if item)
        findings = output.get("findings")
        if isinstance(findings, list):
            for finding in findings[:5]:
                if isinstance(finding, dict) and finding.get("severity") in {"warn", "fail"}:
                    risks.append(str(finding.get("message") or finding.get("code")))
        route_warnings = output.get("deterministic_warnings")
        if isinstance(route_warnings, list):
            for warning in route_warnings[:5]:
                if isinstance(warning, dict):
                    risks.append(str(warning.get("message") or warning.get("code")))
    deduped: list[str] = []
    for risk in risks:
        if risk and risk not in deduped:
            deduped.append(risk)
    return deduped


def _decision_from_risks_and_confidence(risks: list[str], confidence: Optional[float]) -> str:
    if confidence is not None and confidence < 0.45:
        return "block_or_refresh"
    if len(risks) >= 4:
        return "escalate"
    if risks:
        return "review"
    return "proceed"


def render_decision_package_markdown(package: dict[str, Any]) -> str:
    entity = package.get("entity") or {}
    route = package.get("routeSummary") or {}
    procurement = package.get("procurementAwardsSummary") or {}
    risks = package.get("risks") or []
    lines = [
        f"# Decision Package: {package.get('dealRoom', {}).get('title') or entity.get('company') or entity.get('id')}",
        "",
        f"- Entity: {entity.get('company') or entity.get('id')} ({entity.get('country') or 'unknown country'})",
        f"- Commodity: {entity.get('commodity') or 'unknown'}",
        f"- Decision: {package.get('decision')}",
        f"- Confidence: {package.get('confidence') if package.get('confidence') is not None else 'n/a'}",
        "",
        "## Route",
        f"- Status: {route.get('status')}",
        f"- Source: {route.get('source') or 'n/a'}",
        f"- Total cost USD: {route.get('totalCostUsd') if route.get('totalCostUsd') is not None else 'n/a'}",
        f"- Recommendation: {route.get('recommendation') or 'n/a'}",
        "",
        "## Procurement",
        f"- Award count: {procurement.get('awardCount') or procurement.get('award_count') or 0}",
        f"- Total awarded USD: {procurement.get('totalAwardedUsd') or procurement.get('total_awarded_usd') or 0}",
        f"- Related USAspending (fuzzy): {len(package.get('relatedUsaAwards') or [])}",
        f"- Related EU TED notices (fuzzy): {len(package.get('relatedEuNotices') or [])}",
        "",
        "## Risks",
    ]
    lines.extend([f"- {risk}" for risk in risks[:12]] or ["- No material risks recorded yet."])
    lines.extend(["", "## Agent Outputs"])
    for agent_type, output in (package.get("agentOutputs") or {}).items():
        if isinstance(output, dict):
            lines.append(f"- {agent_type}: {output.get('status') or output.get('risk_level') or output.get('recommendation') or 'completed'}")
    return "\n".join(lines) + "\n"

