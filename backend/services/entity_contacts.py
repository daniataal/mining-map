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
    "source_backed_record",
)

CONTACT_TYPE_ORDER = {
    "phone": 0,
    "email": 1,
    "website": 2,
    "address": 3,
}

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
URL_RE = re.compile(r"^(https?://|www\.)", re.IGNORECASE)
PHONE_ALLOWED_RE = re.compile(r"^[+()0-9.\- /extEXT]+$")


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


def _classify_contact_field(path: str) -> Optional[str]:
    tokens = _normalize_key_tokens(path)
    if not tokens:
        return None
    collapsed = "".join(tokens)

    phone_keys = {
        "phone",
        "phonenumber",
        "contactphone",
        "telephone",
        "tel",
        "officephone",
        "companyphone",
        "operatorphone",
        "businessphone",
    }
    email_keys = {
        "email",
        "contactemail",
        "emailaddress",
        "companyemail",
        "operatoremail",
    }
    website_keys = {
        "website",
        "contactwebsite",
        "companywebsite",
        "operatorwebsite",
        "homepage",
        "url",
        "web",
    }
    address_keys = {
        "address",
        "officeaddress",
        "registeredaddress",
        "postaladdress",
        "physicaladdress",
        "companyaddress",
    }

    if collapsed in phone_keys or tokens[-1] in {"phone", "telephone", "tel"}:
        return "phone"
    if collapsed in email_keys or tokens[-1] == "email":
        return "email"
    if collapsed in website_keys or tokens[-1] in {"website", "homepage", "url", "web"}:
        return "website"
    if collapsed in address_keys or tokens[-1] == "address":
        return "address"
    if "contact" in tokens and "phone" in tokens:
        return "phone"
    if "contact" in tokens and "email" in tokens:
        return "email"
    if "contact" in tokens and ("website" in tokens or "url" in tokens):
        return "website"
    return None


def _split_multi_value(contact_type: str, value: str) -> list[str]:
    if contact_type == "address":
        return [value]
    parts = re.split(r"[;\n|]+", value)
    cleaned = [part.strip() for part in parts if part and part.strip()]
    return cleaned or [value]


def _is_valid_contact_value(contact_type: str, value: str) -> bool:
    cleaned = _clean_text(value)
    if not cleaned:
        return False
    if contact_type == "phone":
        digits = re.sub(r"\D", "", cleaned)
        return 7 <= len(digits) <= 18 and bool(PHONE_ALLOWED_RE.match(cleaned))
    if contact_type == "email":
        return bool(EMAIL_RE.match(cleaned))
    if contact_type == "website":
        return "." in cleaned and " " not in cleaned
    if contact_type == "address":
        return len(cleaned) >= 6
    return False


def _normalized_contact_value(contact_type: str, value: str) -> str:
    cleaned = _clean_text(value) or ""
    if contact_type == "phone":
        digits = re.sub(r"\D", "", cleaned)
        return digits or cleaned.lower()
    if contact_type == "email":
        return cleaned.lower()
    if contact_type == "website":
        without_scheme = re.sub(r"^https?://", "", cleaned, flags=re.IGNORECASE)
        return without_scheme.rstrip("/").lower()
    return cleaned.lower()


def _friendly_label(contact_type: str, extracted_from: str) -> str:
    leaf = extracted_from.split(".")[-1].replace("_", " ").replace(":", " ").strip()
    if not leaf:
        return contact_type.title()
    if leaf.lower() in {"phone", "phone number", "email", "website", "address", "url"}:
        return contact_type.title()
    return leaf.title()


def _source_type_for_row(row: dict[str, Any]) -> str:
    if (row.get("record_origin") or "").strip().lower() == "open_data":
        return "official_open_data"
    return "source_backed_record"


def _confidence_for_row(contact_type: str, extracted_from: str, source_type: str) -> float:
    if source_type == "official_open_data":
        base = {
            "phone": 0.93,
            "email": 0.92,
            "website": 0.89,
            "address": 0.86,
        }.get(contact_type, 0.8)
        if extracted_from == "licenses.phone_number":
            return base - 0.06
        return base
    fallback = {
        "phone": 0.78,
        "email": 0.77,
        "website": 0.75,
        "address": 0.72,
    }.get(contact_type, 0.68)
    if extracted_from == "licenses.phone_number":
        return fallback - 0.05
    return fallback


def _fingerprint(
    entity_kind: str,
    entity_id: str,
    contact_type: str,
    normalized_value: str,
    source_name: Optional[str],
    source_url: Optional[str],
) -> str:
    raw = "|".join(
        [
            entity_kind,
            entity_id,
            contact_type,
            normalized_value,
            (source_name or "").strip().lower(),
            (source_url or "").strip().lower(),
        ]
    )
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


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


def _has_reliable_public_source(row: dict[str, Any]) -> bool:
    record_origin = (row.get("record_origin") or "").strip().lower()
    if row.get("source_record_url") or row.get("source_url"):
        return True
    return record_origin == "open_data" and bool(row.get("source_name"))


def build_license_contact_candidates(row: dict[str, Any]) -> list[dict[str, Any]]:
    entity_id = _clean_text(row.get("id"))
    if not entity_id or not _has_reliable_public_source(row):
        return []

    source_name = _clean_text(row.get("source_name")) or "Source-backed record"
    source_url = _clean_text(row.get("source_record_url")) or _clean_text(row.get("source_url"))
    source_type = _source_type_for_row(row)
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

    def add_candidate(contact_type: str, value: Any, extracted_from: str, evidence: dict[str, Any]) -> None:
        cleaned = _clean_text(value)
        if not cleaned:
            return
        for piece in _split_multi_value(contact_type, cleaned):
            if not _is_valid_contact_value(contact_type, piece):
                continue
            normalized_value = _normalized_contact_value(contact_type, piece)
            fingerprint = _fingerprint(
                "license",
                entity_id,
                contact_type,
                normalized_value,
                source_name,
                source_url,
            )
            candidates[fingerprint] = {
                "id": fingerprint,
                "fingerprint": fingerprint,
                "entity_kind": "license",
                "entity_id": entity_id,
                "contact_type": contact_type,
                "contact_scope": "public_business",
                "label": _friendly_label(contact_type, extracted_from),
                "value": piece,
                "normalized_value": normalized_value,
                "source_name": source_name,
                "source_url": source_url,
                "source_type": source_type,
                "confidence_score": _confidence_for_row(contact_type, extracted_from, source_type),
                "raw_payload": evidence,
                "extracted_from": extracted_from,
                "verified_at": verified_at,
            }

    legacy_phone = _clean_text(row.get("phone_number"))
    if legacy_phone:
        add_candidate(
            "phone",
            legacy_phone,
            "licenses.phone_number",
            {
                "field": "licenses.phone_number",
                "value": legacy_phone,
                "record_origin": row.get("record_origin"),
                "source_name": row.get("source_name"),
                "source_url": source_url,
            },
        )

    if isinstance(raw_payload, (dict, list)):
        for path, leaf_value in _iter_leaf_paths(raw_payload):
            contact_type = _classify_contact_field(path)
            if contact_type is None:
                continue
            add_candidate(
                contact_type,
                leaf_value,
                path,
                {
                    "field": path,
                    "value": leaf_value,
                    "source_name": row.get("source_name"),
                    "source_url": source_url,
                },
            )

    return sorted(
        candidates.values(),
        key=lambda item: (
            CONTACT_TYPE_ORDER.get(item["contact_type"], 99),
            -(item["confidence_score"] or 0.0),
            item["value"].lower(),
        ),
    )


def sync_license_contacts_for_row(conn: Any, row: dict[str, Any]) -> int:
    entity_id = _clean_text(row.get("id"))
    if not entity_id:
        return 0

    candidates = build_license_contact_candidates(row)
    with conn.cursor() as cur:
        cur.execute(
            """
            DELETE FROM entity_contacts
            WHERE entity_kind = 'license'
              AND entity_id = %s
              AND source_type IN ('official_open_data', 'source_backed_record')
            """,
            (entity_id,),
        )
        if not candidates:
            return 0
        for candidate in candidates:
            cur.execute(
                """
                INSERT INTO entity_contacts (
                    id,
                    fingerprint,
                    entity_kind,
                    entity_id,
                    contact_type,
                    contact_scope,
                    label,
                    value,
                    normalized_value,
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
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP
                )
                ON CONFLICT (fingerprint) DO UPDATE SET
                    label = EXCLUDED.label,
                    value = EXCLUDED.value,
                    normalized_value = EXCLUDED.normalized_value,
                    source_name = EXCLUDED.source_name,
                    source_url = EXCLUDED.source_url,
                    source_type = EXCLUDED.source_type,
                    confidence_score = EXCLUDED.confidence_score,
                    raw_payload = EXCLUDED.raw_payload,
                    extracted_from = EXCLUDED.extracted_from,
                    verified_at = COALESCE(EXCLUDED.verified_at, entity_contacts.verified_at),
                    last_seen_at = CURRENT_TIMESTAMP
                """,
                (
                    candidate["id"],
                    candidate["fingerprint"],
                    candidate["entity_kind"],
                    candidate["entity_id"],
                    candidate["contact_type"],
                    candidate["contact_scope"],
                    candidate["label"],
                    candidate["value"],
                    candidate["normalized_value"],
                    candidate["source_name"],
                    candidate["source_url"],
                    candidate["source_type"],
                    candidate["confidence_score"],
                    Json(candidate["raw_payload"]),
                    candidate["extracted_from"],
                    candidate["verified_at"],
                ),
            )
    return len(candidates)


def sync_license_contacts(conn: Any, license_id: str) -> int:
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            SELECT
                id,
                phone_number,
                record_origin,
                source_name,
                source_url,
                source_record_url,
                source_updated_at,
                raw_payload,
                last_synced_at
            FROM licenses
            WHERE id = %s
            """,
            (license_id,),
        )
        row = cur.fetchone()
    if not row:
        return 0
    return sync_license_contacts_for_row(conn, row)


def sync_all_license_contacts(conn: Any) -> int:
    total = 0
    with conn.cursor(**_cursor_kwargs()) as cur:
        cur.execute(
            """
            SELECT
                id,
                phone_number,
                record_origin,
                source_name,
                source_url,
                source_record_url,
                source_updated_at,
                raw_payload,
                last_synced_at
            FROM licenses
            """
        )
        rows = cur.fetchall()
    for row in rows:
        total += sync_license_contacts_for_row(conn, row)
    return total
