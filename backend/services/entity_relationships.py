from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime
from typing import Any, Optional

try:
    from psycopg2.extras import Json, RealDictCursor
except ImportError:
    RealDictCursor = None

    def Json(value: Any) -> Any:
        return value


AUTO_MANAGED_SOURCE_TYPES = (
    "official_open_data",
    "user_import_csv",
    "source_backed_record",
)

RELATIONSHIP_TYPE_ORDER = {
    "beneficial_owner": 0,
    "parent_company": 1,
    "subsidiary": 2,
    "owner": 3,
    "license_holder": 4,
    "operator": 5,
    "manager": 6,
    "charterer": 7,
    "trader": 8,
    "counterparty": 9,
}

OWNERSHIP_PERCENT_RE = re.compile(r"(?P<name>[^;|\n]+?)\s*\((?P<pct>\d{1,3}(?:\.\d+)?)%\)")


def _clean_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        cleaned = " ".join(value.split())
        return cleaned or None
    cleaned = str(value).strip()
    return cleaned or None


def _cursor_kwargs() -> dict[str, Any]:
    if RealDictCursor is None:
        return {}
    return {"cursor_factory": RealDictCursor}


def _parse_datetime(value: Any) -> Optional[datetime]:
    if value in (None, "", " "):
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=None)
    raw = _clean_text(value)
    if not raw:
        return None
    candidate = raw.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(candidate)
        return parsed.replace(tzinfo=None)
    except ValueError:
        return None


def _normalize_key_tokens(path: str) -> list[str]:
    normalized = re.sub(r"[^a-z0-9]+", " ", path.lower())
    return [token for token in normalized.split() if token]


def _iter_leaf_paths(node: Any, prefix: str = ""):
    if isinstance(node, dict):
        for key, value in node.items():
            next_prefix = f"{prefix}.{key}" if prefix else str(key)
            yield from _iter_leaf_paths(value, next_prefix)
        return
    if isinstance(node, list):
        for index, value in enumerate(node):
            next_prefix = f"{prefix}[{index}]"
            yield from _iter_leaf_paths(value, next_prefix)
        return
    yield prefix, node


def _source_type_for_row(row: dict[str, Any]) -> str:
    record_origin = (row.get("record_origin") or "").strip().lower()
    if record_origin == "open_data":
        return "official_open_data"
    if record_origin == "user_import_csv":
        return "user_import_csv"
    return "source_backed_record"


def _has_reliable_source(row: dict[str, Any]) -> bool:
    if _clean_text(row.get("source_name")) or _clean_text(row.get("source_url")) or _clean_text(row.get("source_record_url")):
        return True
    return (row.get("record_origin") or "").strip().lower() in {"open_data", "user_import_csv"}


def _classify_relationship_field(path: str, row: dict[str, Any]) -> Optional[str]:
    tokens = _normalize_key_tokens(path)
    if not tokens:
        return None
    collapsed = "".join(tokens)

    if "beneficial" in tokens and "owner" in tokens:
        return "beneficial_owner"
    if "parent" in tokens and any(token in tokens for token in ("company", "entity", "owner", "corp", "corporation")):
        return "parent_company"
    if "subsidiary" in tokens:
        return "subsidiary"
    if "charterer" in tokens or ("charter" in tokens and any(token in tokens for token in ("company", "party", "entity"))):
        return "charterer"
    if "manager" in tokens or "management" in tokens:
        return "manager"
    if "trader" in tokens or "offtaker" in tokens:
        return "trader"
    if "counterparty" in tokens or ("buyer" in tokens and "seller" not in tokens) or ("seller" in tokens and "buyer" not in tokens):
        return "counterparty"
    if "operator" in tokens or "operated" in tokens:
        return "operator"
    if "owner" in tokens:
        return "owner"

    if collapsed in {
        "licenseholder",
        "licensee",
        "licenceholder",
        "permittee",
        "holder",
        "holders",
        "lessee",
        "claimant",
        "claimants",
        "concessionaire",
        "company",
        "companies",
        "party",
        "parties",
        "companyname",
        "csename",
    }:
        return "license_holder"

    if tokens[-1] in {"company", "companies", "party", "parties", "holder", "licensee", "lessee", "claimant"}:
        return "license_holder"

    if len(tokens) >= 2 and tokens[-2:] == ["company", "name"]:
        return "license_holder"

    # The generic licenses.company column is a reasonable license-holder fallback,
    # but raw payload "name" fields are too ambiguous to classify.
    if path == "licenses.company":
        return "license_holder"

    return None


def _normalize_target_name(value: str) -> Optional[str]:
    cleaned = _clean_text(value)
    if not cleaned:
        return None
    cleaned = re.sub(r"\(\s*\d{1,3}(?:\.\d+)?%\s*\)\s*$", "", cleaned).strip()
    cleaned = cleaned.strip(" ,;|")
    cleaned = cleaned.strip("\"'")
    return cleaned or None


def _looks_like_company_name(value: str) -> bool:
    cleaned = _clean_text(value)
    if not cleaned:
        return False
    letters = len(re.findall(r"[A-Za-z]", cleaned))
    if letters < 3:
        return False
    if re.fullmatch(r"[A-Z0-9/_ -]+", cleaned) and len(cleaned) <= 8 and not re.search(r"[A-Za-z]{3,}", cleaned):
        return False
    return True


def _extract_relationship_targets(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        results: list[dict[str, Any]] = []
        for item in value:
            results.extend(_extract_relationship_targets(item))
        return results

    cleaned = _clean_text(value)
    if not cleaned:
        return []

    matches = list(OWNERSHIP_PERCENT_RE.finditer(cleaned))
    if matches:
        extracted = []
        for match in matches:
            name = _normalize_target_name(match.group("name") or "")
            if not name or not _looks_like_company_name(name):
                continue
            try:
                pct = float(match.group("pct"))
            except (TypeError, ValueError):
                pct = None
            extracted.append({"name": name, "ownership_pct": pct})
        if extracted:
            return extracted

    pieces = [cleaned]
    if re.search(r"[;\n|]+", cleaned):
        pieces = [part.strip() for part in re.split(r"[;\n|]+", cleaned) if part and part.strip()]

    results = []
    for piece in pieces:
        name = _normalize_target_name(piece)
        if not name or not _looks_like_company_name(name):
            continue
        results.append({"name": name, "ownership_pct": None})
    return results


def _confidence_for_candidate(
    relationship_type: str,
    extracted_from: str,
    source_type: str,
) -> float:
    base = {
        "beneficial_owner": 0.92,
        "owner": 0.9,
        "license_holder": 0.88,
        "operator": 0.9,
        "manager": 0.85,
        "parent_company": 0.82,
        "subsidiary": 0.82,
        "charterer": 0.8,
        "trader": 0.78,
        "counterparty": 0.76,
    }.get(relationship_type, 0.72)

    if source_type == "user_import_csv":
        base -= 0.16
    elif source_type == "source_backed_record":
        base -= 0.08

    if extracted_from == "licenses.company":
        base -= 0.06

    return max(0.35, min(0.98, base))


def _fingerprint(
    source_entity_kind: str,
    source_entity_ref: str,
    relationship_type: str,
    target_name: str,
    source_name: Optional[str],
    source_url: Optional[str],
) -> str:
    raw = "|".join(
        [
            source_entity_kind,
            source_entity_ref,
            relationship_type,
            target_name.strip().lower(),
            (source_name or "").strip().lower(),
            (source_url or "").strip().lower(),
        ]
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


def build_license_relationship_candidates(row: dict[str, Any]) -> list[dict[str, Any]]:
    entity_id = _clean_text(row.get("id"))
    if not entity_id or not _has_reliable_source(row):
        return []

    source_name = _clean_text(row.get("source_name")) or "Source-backed record"
    source_url = _clean_text(row.get("source_record_url")) or _clean_text(row.get("source_url"))
    source_type = _source_type_for_row(row)
    effective_date = _parse_datetime(row.get("date_issued"))
    verified_at = (
        _parse_datetime(row.get("source_updated_at"))
        or _parse_datetime(row.get("last_synced_at"))
        or _parse_datetime(row.get("updated_at"))
    )

    raw_payload_value = row.get("raw_payload")
    raw_payload: Any = None
    if isinstance(raw_payload_value, (dict, list)):
        raw_payload = raw_payload_value
    elif isinstance(raw_payload_value, str):
        try:
            raw_payload = json.loads(raw_payload_value)
        except (TypeError, ValueError):
            raw_payload = None

    candidates: dict[str, dict[str, Any]] = {}

    def add_candidate(
        relationship_type: str,
        raw_value: Any,
        extracted_from: str,
        evidence: dict[str, Any],
    ) -> None:
        for target in _extract_relationship_targets(raw_value):
            target_name = target["name"]
            fingerprint = _fingerprint(
                "license",
                entity_id,
                relationship_type,
                target_name,
                source_name,
                source_url,
            )
            candidates[fingerprint] = {
                "id": fingerprint,
                "fingerprint": fingerprint,
                "source_entity_kind": "license",
                "source_entity_ref": entity_id,
                "target_entity_kind": "entity",
                "target_entity_ref": None,
                "target_name": target_name,
                "relationship_type": relationship_type,
                "relationship_label": None,
                "ownership_pct": target.get("ownership_pct"),
                "effective_date": effective_date,
                "source_name": source_name,
                "source_url": source_url,
                "source_type": source_type,
                "confidence_score": _confidence_for_candidate(
                    relationship_type,
                    extracted_from,
                    source_type,
                ),
                "raw_payload": evidence,
                "extracted_from": extracted_from,
                "verified_at": verified_at,
            }

    if isinstance(raw_payload, (dict, list)):
        for path, leaf_value in _iter_leaf_paths(raw_payload):
            relationship_type = _classify_relationship_field(path, row)
            if relationship_type is None:
                continue
            add_candidate(
                relationship_type,
                leaf_value,
                path,
                {
                    "field": path,
                    "value": leaf_value,
                    "record_origin": row.get("record_origin"),
                    "source_name": source_name,
                    "source_url": source_url,
                },
            )

    # Preserve a low-friction fallback so license rows that only carry a single
    # named company still expose that recorded party as a license-holder signal.
    if not candidates:
        company = _clean_text(row.get("company"))
        if company:
            add_candidate(
                "license_holder",
                company,
                "licenses.company",
                {
                    "field": "licenses.company",
                    "value": company,
                    "record_origin": row.get("record_origin"),
                    "source_name": source_name,
                    "source_url": source_url,
                },
            )

    return sorted(
        candidates.values(),
        key=lambda item: (
            RELATIONSHIP_TYPE_ORDER.get(item["relationship_type"], 99),
            (item["target_name"] or "").lower(),
        ),
    )


UPSERT_SQL = """
    INSERT INTO entity_relationships (
        fingerprint,
        source_entity_kind,
        source_entity_ref,
        target_entity_kind,
        target_entity_ref,
        target_name,
        relationship_type,
        relationship_label,
        rel_type,
        ownership_pct,
        effective_date,
        source_name,
        source_url,
        source_type,
        confidence_score,
        raw_payload,
        extracted_from,
        verified_at,
        last_seen_at
    )
    VALUES (
        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
        %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP
    )
    ON CONFLICT (fingerprint) DO UPDATE SET
        source_entity_kind = EXCLUDED.source_entity_kind,
        source_entity_ref = EXCLUDED.source_entity_ref,
        target_entity_kind = EXCLUDED.target_entity_kind,
        target_entity_ref = EXCLUDED.target_entity_ref,
        target_name = EXCLUDED.target_name,
        relationship_type = EXCLUDED.relationship_type,
        relationship_label = EXCLUDED.relationship_label,
        rel_type = EXCLUDED.rel_type,
        ownership_pct = EXCLUDED.ownership_pct,
        effective_date = EXCLUDED.effective_date,
        source_name = EXCLUDED.source_name,
        source_url = EXCLUDED.source_url,
        source_type = EXCLUDED.source_type,
        confidence_score = EXCLUDED.confidence_score,
        raw_payload = EXCLUDED.raw_payload,
        extracted_from = EXCLUDED.extracted_from,
        verified_at = COALESCE(EXCLUDED.verified_at, entity_relationships.verified_at),
        last_seen_at = CURRENT_TIMESTAMP;
"""


def sync_license_relationships_for_row(conn: Any, row: dict[str, Any]) -> int:
    entity_id = _clean_text(row.get("id"))
    if not entity_id:
        return 0

    candidates = build_license_relationship_candidates(row)
    fingerprints = [candidate["fingerprint"] for candidate in candidates]

    with conn.cursor() as cur:
        for candidate in candidates:
            cur.execute(
            """
            INSERT INTO entity_relationships (
                fingerprint,
                source_entity_kind,
                source_entity_ref,
                target_entity_kind,
                target_entity_ref,
                target_name,
                relationship_type,
                relationship_label,
                rel_type,
                ownership_pct,
                effective_date,
                source_name,
                source_url,
                source_type,
                confidence_score,
                raw_payload,
                extracted_from,
                verified_at,
                discovered_by,
                last_seen_at
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP
            )
            ON CONFLICT (fingerprint) DO UPDATE SET
                source_entity_kind = EXCLUDED.source_entity_kind,
                source_entity_ref = EXCLUDED.source_entity_ref,
                target_entity_kind = EXCLUDED.target_entity_kind,
                target_entity_ref = EXCLUDED.target_entity_ref,
                target_name = EXCLUDED.target_name,
                relationship_type = EXCLUDED.relationship_type,
                relationship_label = EXCLUDED.relationship_label,
                rel_type = EXCLUDED.rel_type,
                ownership_pct = EXCLUDED.ownership_pct,
                effective_date = EXCLUDED.effective_date,
                source_name = EXCLUDED.source_name,
                source_url = EXCLUDED.source_url,
                source_type = EXCLUDED.source_type,
                confidence_score = EXCLUDED.confidence_score,
                raw_payload = EXCLUDED.raw_payload,
                extracted_from = EXCLUDED.extracted_from,
                verified_at = COALESCE(EXCLUDED.verified_at, entity_relationships.verified_at),
                discovered_by = EXCLUDED.discovered_by,
                last_seen_at = CURRENT_TIMESTAMP;
            """,
            (
                candidate["fingerprint"],
                candidate["source_entity_kind"],
                candidate["source_entity_ref"],
                candidate["target_entity_kind"],
                candidate["target_entity_ref"],
                candidate["target_name"],
                candidate["relationship_type"],
                candidate["relationship_label"],
                candidate["relationship_type"],
                candidate["ownership_pct"],
                candidate["effective_date"],
                candidate["source_name"],
                candidate["source_url"],
                candidate["source_type"],
                candidate["confidence_score"],
                Json(candidate["raw_payload"]),
                candidate["extracted_from"],
                candidate["verified_at"],
                candidate.get("discovered_by", "open_data"),
            ),
        )

        source_type_placeholders = ", ".join(["%s"] * len(AUTO_MANAGED_SOURCE_TYPES))
        params: list[Any] = ["license", entity_id, *AUTO_MANAGED_SOURCE_TYPES]
        sql = f"""
            DELETE FROM entity_relationships
            WHERE source_entity_kind = %s
              AND source_entity_ref = %s
              AND source_type IN ({source_type_placeholders})
        """
        if fingerprints:
            fingerprint_placeholders = ", ".join(["%s"] * len(fingerprints))
            sql += f" AND fingerprint NOT IN ({fingerprint_placeholders})"
            params.extend(fingerprints)
        cur.execute(sql, tuple(params))

    return len(candidates)


def sync_license_relationships(conn: Any, entity_id: str) -> int:
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            SELECT
                id,
                company,
                sector,
                record_origin,
                source_name,
                source_url,
                source_record_url,
                source_updated_at,
                date_issued,
                raw_payload,
                last_synced_at
            FROM licenses
            WHERE id = %s
            """,
            (entity_id,),
        )
        row = cur.fetchone()

    if not row:
        return 0
    return sync_license_relationships_for_row(conn, row)


def sync_all_license_relationships(conn: Any) -> int:
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            SELECT
                id,
                company,
                sector,
                record_origin,
                source_name,
                source_url,
                source_record_url,
                source_updated_at,
                date_issued,
                raw_payload,
                last_synced_at
            FROM licenses
            WHERE company IS NOT NULL
              AND COALESCE(company, '') != ''
            """
        )
        rows = cur.fetchall()

    total = 0
    for row in rows:
        total += sync_license_relationships_for_row(conn, row)
    return total
