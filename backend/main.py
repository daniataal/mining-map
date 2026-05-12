from fastapi import FastAPI, UploadFile, File, Response, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import json
import psycopg2
from psycopg2 import sql
from psycopg2.extras import Json, RealDictCursor
import time
import os
import csv
import io
import uuid
from pydantic import BaseModel
from typing import Any, Optional
from urllib.parse import urlparse, urlunparse

from country_borders import get_country_borders_geojson, parse_requested_countries
from license_import_geo import resolve_location_to_coords, validate_lat_lng_range

app = FastAPI()


def _load_entity_contact_services():
    try:
        from backend.services.entity_contacts import sync_all_license_contacts, sync_license_contacts
    except ImportError:
        from services.entity_contacts import sync_all_license_contacts, sync_license_contacts
    return sync_all_license_contacts, sync_license_contacts


def _load_entity_relationship_services():
    try:
        from backend.services.entity_relationships import (
            sync_all_license_relationships,
            sync_license_relationships,
        )
    except ImportError:
        from services.entity_relationships import (
            sync_all_license_relationships,
            sync_license_relationships,
        )
    return sync_all_license_relationships, sync_license_relationships


def _load_entity_contact_helpers():
    try:
        from backend.services.entity_contacts import (
            build_license_contact_candidates,
            upsert_entity_contact_candidates,
        )
    except ImportError:
        from services.entity_contacts import (
            build_license_contact_candidates,
            upsert_entity_contact_candidates,
        )
    return build_license_contact_candidates, upsert_entity_contact_candidates


def _load_dd_services():
    try:
        from backend.services.dd.orchestrator import (
            build_promotable_contact_candidates,
            generate_dd_report,
        )
    except ImportError:
        from services.dd.orchestrator import (
            build_promotable_contact_candidates,
            generate_dd_report,
        )
    return generate_dd_report, build_promotable_contact_candidates


def _serialize_entity_contact(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "entityKind": row.get("entity_kind"),
        "entityId": row.get("entity_id"),
        "contactType": row.get("contact_type"),
        "contactScope": row.get("contact_scope"),
        "label": row.get("label"),
        "value": row.get("value"),
        "sourceName": row.get("source_name"),
        "sourceUrl": row.get("source_url"),
        "sourceType": row.get("source_type"),
        "confidenceScore": row.get("confidence_score"),
        "rawPayload": row.get("raw_payload"),
        "extractedFrom": row.get("extracted_from"),
        "verifiedAt": row.get("verified_at"),
        "lastSeenAt": row.get("last_seen_at"),
    }


def _serialize_entity_relationship(row: dict) -> dict:
    return {
        "id": row.get("id"),
        "sourceEntityKind": row.get("source_entity_kind"),
        "sourceEntityRef": row.get("source_entity_ref"),
        "targetEntityKind": row.get("target_entity_kind"),
        "targetEntityRef": row.get("target_entity_ref"),
        "targetName": row.get("target_name"),
        "relationshipType": row.get("relationship_type") or row.get("rel_type"),
        "relationshipLabel": row.get("relationship_label"),
        "ownershipPct": row.get("ownership_pct"),
        "effectiveDate": row.get("effective_date"),
        "sourceName": row.get("source_name"),
        "sourceUrl": row.get("source_url"),
        "sourceType": row.get("source_type"),
        "confidenceScore": row.get("confidence_score"),
        "rawPayload": row.get("raw_payload"),
        "extractedFrom": row.get("extracted_from"),
        "verifiedAt": row.get("verified_at"),
        "lastSeenAt": row.get("last_seen_at"),
    }


def _serialize_dd_contact(contact: dict[str, Any]) -> dict[str, Any]:
    return {
        "contactType": contact.get("contact_type"),
        "value": contact.get("value"),
        "label": contact.get("label"),
        "contactScope": contact.get("contact_scope"),
        "contactRole": contact.get("contact_role"),
        "sourceName": contact.get("source_name"),
        "sourceUrl": contact.get("source_url"),
        "evidenceSnippet": contact.get("evidence_snippet"),
        "extractedFrom": contact.get("extracted_from"),
        "sourceBasis": contact.get("source_basis"),
        "confidence": contact.get("confidence"),
        "verifiedAt": contact.get("verified_at"),
        "autoPromoted": contact.get("auto_promoted"),
        "promotedContactId": contact.get("promoted_contact_id"),
    }


def _serialize_dd_report(row: dict) -> dict:
    source_snapshot = row.get("source_snapshot") if isinstance(row.get("source_snapshot"), dict) else {}
    source_summary = source_snapshot.get("source") if isinstance(source_snapshot.get("source"), dict) else {}
    extracted_contacts = row.get("extracted_contacts")
    if not isinstance(extracted_contacts, list):
        extracted_contacts = []
    promoted_contacts = row.get("promoted_contacts")
    if not isinstance(promoted_contacts, list):
        promoted_contacts = []

    return {
        "id": row.get("id"),
        "entityKind": row.get("entity_kind"),
        "entityId": row.get("entity_id"),
        "status": row.get("status"),
        "provider": row.get("provider"),
        "model": row.get("model"),
        "extractionProvider": row.get("extraction_provider"),
        "extractionModel": row.get("extraction_model"),
        "promptVersion": row.get("prompt_version"),
        "analysis": row.get("analysis_text"),
        "sourceSummary": {
            "sourceName": source_summary.get("source_name"),
            "sourceUrl": source_summary.get("source_url"),
            "sourceRecordUrl": source_summary.get("source_record_url"),
            "recordOrigin": source_summary.get("record_origin"),
            "lastSyncedAt": source_summary.get("last_synced_at"),
        },
        "extractedContacts": [
            _serialize_dd_contact(contact)
            for contact in extracted_contacts
            if isinstance(contact, dict)
        ],
        "promotedContacts": promoted_contacts,
        "createdAt": row.get("created_at"),
    }


def _safe_json_load(value: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return None
    return None


def _normalize_promoted_lookup_key(contact_type: str, value: Any, source_url: Any) -> tuple[str, str, str]:
    normalized_type = (contact_type or "").strip().lower()
    raw_value = str(value or "").strip()
    if normalized_type == "phone":
        normalized_value = "".join(ch for ch in raw_value if ch.isdigit())
    elif normalized_type == "website":
        normalized_value = raw_value.lower().removeprefix("https://").removeprefix("http://").rstrip("/")
    else:
        normalized_value = raw_value.lower()
    return normalized_type, normalized_value, str(source_url or "").strip().lower()


def _annotate_dd_contacts(
    extracted_contacts: list[dict[str, Any]],
    promoted_candidates: list[dict[str, Any]],
    *,
    default_source_name: Optional[str],
    default_source_url: Optional[str],
) -> list[dict[str, Any]]:
    promoted_lookup = {
        _normalize_promoted_lookup_key(
            candidate.get("contact_type"),
            candidate.get("value"),
            candidate.get("source_url"),
        ): candidate
        for candidate in promoted_candidates
    }
    annotated: list[dict[str, Any]] = []
    for contact in extracted_contacts:
        merged = dict(contact)
        if not merged.get("source_name"):
            merged["source_name"] = default_source_name
        if not merged.get("source_url"):
            merged["source_url"] = default_source_url
        promoted = promoted_lookup.get(
            _normalize_promoted_lookup_key(
                merged.get("contact_type"),
                merged.get("value"),
                merged.get("source_url"),
            )
        )
        merged["auto_promoted"] = promoted is not None
        merged["promoted_contact_id"] = promoted.get("id") if promoted else None
        annotated.append(merged)
    return annotated


def _load_license_dd_snapshot(conn, entity_id: str) -> Optional[dict[str, Any]]:
    build_license_contact_candidates, _ = _load_entity_contact_helpers()
    with conn.cursor(cursor_factory=RealDictCursor) as cur:
        cur.execute("SELECT * FROM licenses WHERE id = %s", (entity_id,))
        row = cur.fetchone()
    if not row:
        return None

    raw_payload = _safe_json_load(row.get("raw_payload"))
    contact_row = dict(row)
    contact_row["raw_payload"] = raw_payload
    source_backed_contacts = [
        {
            "contact_type": contact.get("contact_type"),
            "value": contact.get("value"),
            "label": contact.get("label"),
            "source_name": contact.get("source_name"),
            "source_url": contact.get("source_url"),
            "source_type": contact.get("source_type"),
            "confidence_score": contact.get("confidence_score"),
            "extracted_from": contact.get("extracted_from"),
        }
        for contact in build_license_contact_candidates(contact_row)
    ]

    return {
        "entity": {
            "id": row.get("id"),
            "company": row.get("company"),
            "country": row.get("country"),
            "region": row.get("region"),
            "commodity": row.get("commodity"),
            "sector": row.get("sector") or "mining",
            "license_type": row.get("license_type"),
            "status": row.get("status"),
        },
        "source": {
            "record_origin": row.get("record_origin"),
            "source_name": row.get("source_name"),
            "source_url": row.get("source_url"),
            "source_record_url": row.get("source_record_url"),
            "source_updated_at": row.get("source_updated_at"),
            "last_synced_at": row.get("last_synced_at"),
        },
        "legacy_license_fields": {
            "phone_number": row.get("phone_number"),
            "contact_person": row.get("contact_person"),
        },
        "source_backed_contacts": source_backed_contacts,
        "raw_payload": raw_payload,
    }


def _coords_need_fallback(lat, lng) -> bool:
    """Treat null/NaN and the legacy 0,0 placeholder as missing coordinates."""
    if lat is None or lng is None:
        return True
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except (TypeError, ValueError):
        return True
    if lat_f != lat_f or lng_f != lng_f:  # NaN check without extra imports
        return True
    return lat_f == 0.0 and lng_f == 0.0


def _build_geo_cache_query_key(country: Optional[str], region: Optional[str]) -> Optional[str]:
    region_lines = [part.strip() for part in (region or "").strip().splitlines() if part and part.strip()]
    region_first = region_lines[0] if region_lines else ""
    parts = [part for part in ((region_first or "").strip(), (country or "").strip()) if part]
    if not parts:
        return None
    return ", ".join(parts).lower()


def _load_cached_geo_fallbacks(cur, rows) -> dict[str, dict]:
    keys = sorted(
        {
            key
            for row in rows
            if _coords_need_fallback(row.get("lat"), row.get("lng"))
            for key in [_build_geo_cache_query_key(row.get("country"), row.get("region"))]
            if key
        }
    )
    if not keys:
        return {}
    try:
        placeholders = ", ".join(["%s"] * len(keys))
        cur.execute(
            f"""
            SELECT query_key, lat, lng, confidence, source, display_name
            FROM geo_cache
            WHERE query_key IN ({placeholders})
            """,
            tuple(keys),
        )
        cached = {}
        for row in cur.fetchall():
            if row.get("source") == "not_found":
                continue
            if row.get("lat") is None or row.get("lng") is None:
                continue
            cached[row["query_key"]] = row
        return cached
    except Exception:
        # geo_cache is optional; normal reads must still succeed when it is absent.
        return {}


def _license_display_coords(row: dict, cached_geo: dict[str, dict]) -> tuple:
    lat = row.get("lat")
    lng = row.get("lng")
    geo_source = row.get("geo_source")
    geo_approximated = row.get("geo_approximated")
    geo_confidence = row.get("geo_confidence")

    if not _coords_need_fallback(lat, lng):
        return lat, lng, geo_source, geo_approximated, geo_confidence

    cache_key = _build_geo_cache_query_key(row.get("country"), row.get("region"))
    cached = cached_geo.get(cache_key) if cache_key else None
    if cached is not None:
        return (
            cached.get("lat"),
            cached.get("lng"),
            cached.get("source") or geo_source,
            True,
            cached.get("confidence"),
        )

    resolved = resolve_location_to_coords(row.get("region") or "", row.get("country") or "")
    if resolved is not None:
        fallback_lat, fallback_lng, fallback_source = resolved
        return fallback_lat, fallback_lng, fallback_source, True, geo_confidence or 0.25

    return lat, lng, geo_source, geo_approximated, geo_confidence

# Allow CORS for local development (so React/Vite can fetch from us)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For dev only. In prod, list the frontend domain.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database connection parameters
DATABASE_URL = os.getenv("DATABASE_URL", "").strip()
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "5432"))
DB_NAME = os.getenv("DB_NAME", "mining_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")
DB_MAINTENANCE_NAME = os.getenv("DB_MAINTENANCE_NAME", "postgres")

def _target_db_connect():
    if DATABASE_URL:
        return psycopg2.connect(DATABASE_URL, connect_timeout=5)
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        database=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        connect_timeout=5,
    )

def _maintenance_db_connect():
    if DATABASE_URL:
        parsed = urlparse(DATABASE_URL)
        maintenance_url = urlunparse(parsed._replace(path=f"/{DB_MAINTENANCE_NAME}"))
        return psycopg2.connect(maintenance_url, connect_timeout=5)
    return psycopg2.connect(
        host=DB_HOST,
        port=DB_PORT,
        database=DB_MAINTENANCE_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        connect_timeout=5,
    )

def _database_missing_error(err: Exception) -> bool:
    msg = str(err)
    return getattr(err, "pgcode", None) == "3D000" or f'database "{DB_NAME}" does not exist' in msg

def _ensure_database_exists():
    conn = _maintenance_db_connect()
    conn.autocommit = True
    cur = conn.cursor()
    try:
        cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DB_NAME,))
        if cur.fetchone():
            return
        cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(DB_NAME)))
        print(f"[db] created missing database: {DB_NAME}")
    finally:
        cur.close()
        conn.close()

def get_db_connection():
    # Simple retry logic for container startup
    retries = 5
    last_error = None
    attempted_create_missing_db = False
    while retries > 0:
        try:
            return _target_db_connect()
        except psycopg2.OperationalError as e:
            if _database_missing_error(e) and not attempted_create_missing_db:
                attempted_create_missing_db = True
                try:
                    print(f"[db] target database {DB_NAME} is missing; attempting bootstrap")
                    _ensure_database_exists()
                    continue
                except Exception as create_exc:
                    last_error = create_exc
                    print(f"[db] failed to create missing database {DB_NAME}: {create_exc}")
            last_error = e
            print(f"Waiting for DB... ({5-retries}/5)")
            time.sleep(2)
            retries -= 1
    target = "DATABASE_URL" if DATABASE_URL else f"{DB_HOST}:{DB_PORT}/{DB_NAME}"
    detail = f"Database unavailable at {target}. Check the Postgres service and backend env vars."
    if last_error:
        print(f"[db] connection failed for {target}: {last_error}")
    raise HTTPException(status_code=503, detail=detail)

# ... existing imports
import bcrypt
import jwt
from datetime import datetime, timedelta

# Authentication Configuration
SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key-change-this-to-something-longer-than-32-bytes")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 # 24 hours

def verify_password(plain_password, hashed_password):
    if isinstance(plain_password, str):
        plain_password = plain_password.encode('utf-8')
    if isinstance(hashed_password, str):
        hashed_password = hashed_password.encode('utf-8')
    return bcrypt.checkpw(plain_password, hashed_password)

def get_password_hash(password):
    if isinstance(password, str):
        password = password.encode('utf-8')
    return bcrypt.hashpw(password, bcrypt.gensalt()).decode('utf-8')

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

def _admin_payload_from_authorization(authorization: Optional[str]):
    if not authorization or not authorization.lower().startswith("bearer "):
        return None, Response("Unauthorized", status_code=401)
    token = authorization.split(" ", 1)[1].strip()
    if not token:
        return None, Response("Unauthorized", status_code=401)
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.PyJWTError:
        return None, Response("Invalid or expired token", status_code=401)
    if payload.get("role") != "admin":
        return None, Response("Forbidden", status_code=403)
    return payload, None

# Models
class UserLogin(BaseModel):
    username: str
    password: str

class UserCreate(BaseModel):
    username: str
    password: str
    role: str = "user" # 'admin' or 'user'

class LogCreate(BaseModel):
    user_id: str
    username: str
    action: str
    details: Optional[str] = None

class MeetingPointCreate(BaseModel):
    name: str
    lat: float
    lng: float
    address: Optional[str] = None
    status: str = 'ACTIVE'

class MinerListingCreate(BaseModel):
    miner_id: str
    lat: float
    lng: float
    price_per_kg: float
    quantity: float
    shape: str
    product: str
    meeting_point_id: str
    meeting_date: Optional[str] = None

class MinerListingVerify(BaseModel):
    status: str
    meeting_outcome: Optional[str] = None
    communication_log: Optional[str] = None

class MinerListingAssay(BaseModel):
    tested_weight: float
    tested_purity: float
    final_offer: float

class MinerListingUpdate(BaseModel):
    lat: Optional[float] = None
    lng: Optional[float] = None
    price_per_kg: Optional[float] = None
    quantity: Optional[float] = None
    shape: Optional[str] = None
    product: Optional[str] = None
    meeting_point_id: Optional[str] = None
    meeting_date: Optional[str] = None

# DB Init Update
def init_db():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        
        # Enable PostGIS
        try:
            cur.execute("CREATE EXTENSION IF NOT EXISTS postgis;")
            conn.commit()
        except Exception as e:
            print(f"PostGIS extension failed: {e}")
            conn.rollback()

        # Entities core table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS entities (
                id VARCHAR(255) PRIMARY KEY,
                name TEXT NOT NULL,
                sector VARCHAR(50),
                subtype VARCHAR(100),
                country VARCHAR(100),
                coordinates GEOMETRY(Point, 4326),
                operational_status VARCHAR(50) DEFAULT 'UNKNOWN',
                confidence_score FLOAT DEFAULT 0.0,
                last_activity TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Entity Aliases
        cur.execute("""
            CREATE TABLE IF NOT EXISTS entity_aliases (
                id SERIAL PRIMARY KEY,
                entity_id VARCHAR(255) REFERENCES entities(id) ON DELETE CASCADE,
                alias TEXT NOT NULL
            );
        """)

        # Entity Sources
        cur.execute("""
            CREATE TABLE IF NOT EXISTS entity_sources (
                id SERIAL PRIMARY KEY,
                entity_id VARCHAR(255) REFERENCES entities(id) ON DELETE CASCADE,
                source_type VARCHAR(100),
                source_url TEXT,
                confidence FLOAT
            );
        """)

        # Entity Signals
        cur.execute("""
            CREATE TABLE IF NOT EXISTS entity_signals (
                id SERIAL PRIMARY KEY,
                entity_id VARCHAR(255) REFERENCES entities(id) ON DELETE CASCADE,
                signal_type VARCHAR(100),
                value FLOAT,
                explanation TEXT,
                signal_time TIMESTAMP
            );
        """)

        # Entity Relationships
        cur.execute("""
            CREATE TABLE IF NOT EXISTS entity_relationships (
                id SERIAL PRIMARY KEY,
                source_entity_id VARCHAR(255) REFERENCES entities(id) ON DELETE CASCADE,
                target_entity_id VARCHAR(255) REFERENCES entities(id) ON DELETE CASCADE,
                rel_type VARCHAR(100)
            );
        """)

        # Dossier Notes
        cur.execute("""
            CREATE TABLE IF NOT EXISTS dossier_notes (
                id VARCHAR(255) PRIMARY KEY,
                entity_id VARCHAR(255) REFERENCES entities(id) ON DELETE CASCADE,
                user_id VARCHAR(255),
                note TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # DD Tasks (Kanban)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS dd_tasks (
                id VARCHAR(255) PRIMARY KEY,
                entity_id VARCHAR(255) REFERENCES entities(id) ON DELETE CASCADE,
                title TEXT,
                description TEXT,
                status VARCHAR(50) DEFAULT 'New',
                assignee_id VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Raw Documents
        cur.execute("""
            CREATE TABLE IF NOT EXISTS raw_documents (
                id VARCHAR(255) PRIMARY KEY,
                entity_id VARCHAR(255) REFERENCES entities(id) ON DELETE CASCADE,
                source TEXT,
                payload JSONB,
                ingested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Persisted AI due-diligence runs. We keep the rendered analysis plus
        # source snapshot and any structured contacts extracted from it so the
        # dossier can be reloaded without re-running the model.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS dd_reports (
                id VARCHAR(255) PRIMARY KEY,
                entity_kind VARCHAR(50) NOT NULL DEFAULT 'license',
                entity_id VARCHAR(255) NOT NULL,
                status VARCHAR(50) NOT NULL,
                provider TEXT,
                model TEXT,
                extraction_provider TEXT,
                extraction_model TEXT,
                prompt_version TEXT,
                query TEXT,
                analysis_text TEXT,
                request_context JSONB,
                source_snapshot JSONB,
                extracted_contacts JSONB,
                promoted_contacts JSONB,
                analysis_raw_response JSONB,
                extraction_raw_response JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_dd_reports_entity_created
            ON dd_reports (entity_kind, entity_id, created_at DESC);
        """)

        # General, source-backed contact store. This is separate from private
        # CRM notes so the dossier can surface reviewable public business
        # numbers/emails/sites without guessing or mixing in internal notes.
        cur.execute("""
            CREATE TABLE IF NOT EXISTS entity_contacts (
                id VARCHAR(255) PRIMARY KEY,
                fingerprint TEXT UNIQUE NOT NULL,
                entity_kind VARCHAR(50) NOT NULL DEFAULT 'license',
                entity_id VARCHAR(255) NOT NULL,
                contact_type VARCHAR(50) NOT NULL,
                contact_scope VARCHAR(50) NOT NULL DEFAULT 'public_business',
                label TEXT,
                value TEXT NOT NULL,
                normalized_value TEXT,
                source_name TEXT,
                source_url TEXT,
                source_type TEXT,
                confidence_score FLOAT DEFAULT 0.0,
                raw_payload JSONB,
                extracted_from TEXT,
                verified_at TIMESTAMP,
                last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Trade Records
        cur.execute("""
            CREATE TABLE IF NOT EXISTS trade_records (
                id VARCHAR(255) PRIMARY KEY,
                entity_id VARCHAR(255) REFERENCES entities(id) ON DELETE CASCADE,
                buyer TEXT,
                seller TEXT,
                commodity TEXT,
                quantity FLOAT,
                price FLOAT,
                trade_date TIMESTAMP
            );
        """)

        # Satellite Observations
        cur.execute("""
            CREATE TABLE IF NOT EXISTS satellite_observations (
                id VARCHAR(255) PRIMARY KEY,
                entity_id VARCHAR(255) REFERENCES entities(id) ON DELETE CASCADE,
                satellite TEXT,
                scene_id TEXT,
                cloud_cover FLOAT,
                observation_date TIMESTAMP
            );
        """)

        # News Mentions
        cur.execute("""
            CREATE TABLE IF NOT EXISTS news_mentions (
                id VARCHAR(255) PRIMARY KEY,
                entity_id VARCHAR(255) REFERENCES entities(id) ON DELETE CASCADE,
                source TEXT,
                title TEXT,
                url TEXT,
                sentiment FLOAT,
                published_at TIMESTAMP
            );
        """)
        
        # Licenses Table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS licenses (
                id VARCHAR(255) PRIMARY KEY,
                company TEXT,
                country TEXT,
                region TEXT,
                commodity TEXT,
                license_type TEXT,
                status TEXT,
                lat FLOAT,
                lng FLOAT,
                phone_number TEXT,
                contact_person TEXT,
                date_issued TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                price_per_kg FLOAT DEFAULT 0.0,
                capacity FLOAT DEFAULT 0.0,
                is_exported BOOLEAN DEFAULT FALSE
            );
        """)
        

        # Migration for existing tables (safe to run every time)
        try:
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS price_per_kg FLOAT DEFAULT 0.0;")
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS capacity FLOAT DEFAULT 0.0;")
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS is_exported BOOLEAN DEFAULT FALSE;")
            # Geocoding provenance — additive, fully reversible. The geocode
            # backfill workflow writes here; never overwrites lat/lng without
            # also stashing the prior value in original_lat/original_lng so a
            # later /api/admin/geocode-licenses/revert can roll it back.
            #   geo_source        : 'user' | 'csv-import' | 'gazetteer' | 'nominatim' | 'mapbox' | 'manual-fix'
            #   geo_approximated  : TRUE when coords come from text geocoding
            #                       (district/region centroid, not a surveyed
            #                       point) — drives the ≈ badge in the UI.
            #   geo_confidence    : geocoder confidence (0..1) when reported
            #   original_lat/lng  : pre-backfill snapshot for safe revert
            #   geocoded_at       : when the backfill last touched this row
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS geo_source VARCHAR(50);")
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS geo_approximated BOOLEAN DEFAULT FALSE;")
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS geo_confidence FLOAT;")
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS original_lat FLOAT;")
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS original_lng FLOAT;")
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS geocoded_at TIMESTAMP;")
            # Open-data provenance. We preserve the existing licenses table and
            # interaction model, but the primary source should now be live
            # official/open registries rather than the bundled JSON snapshot.
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS sector TEXT DEFAULT 'mining';")
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS record_origin VARCHAR(50) DEFAULT 'manual';")
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS source_id TEXT;")
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS source_name TEXT;")
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS source_url TEXT;")
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS source_record_url TEXT;")
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS source_updated_at TEXT;")
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS raw_payload TEXT;")
            cur.execute("ALTER TABLE licenses ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMP;")
            # Normalized relationship layer for cross-sector role transparency.
            # We preserve the old rel_type/source_entity_id columns for backward
            # compatibility and add richer source-backed provenance fields here.
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS fingerprint TEXT;")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS source_entity_kind VARCHAR(50) DEFAULT 'entity';")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS source_entity_ref VARCHAR(255);")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS target_entity_kind VARCHAR(50) DEFAULT 'entity';")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS target_entity_ref VARCHAR(255);")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS target_name TEXT;")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS relationship_type VARCHAR(100);")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS relationship_label TEXT;")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS ownership_pct FLOAT;")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS effective_date TIMESTAMP;")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS source_name TEXT;")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS source_url TEXT;")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS source_type TEXT;")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS confidence_score FLOAT DEFAULT 0.0;")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS raw_payload JSONB;")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS extracted_from TEXT;")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS verified_at TIMESTAMP;")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;")
            cur.execute("ALTER TABLE entity_relationships ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;")
            cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_relationships_fingerprint ON entity_relationships(fingerprint) WHERE fingerprint IS NOT NULL;")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_entity_relationships_source_ref ON entity_relationships(source_entity_kind, source_entity_ref);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_entity_relationships_type ON entity_relationships(relationship_type);")
            conn.commit()
            print("Schema migration successful (added new columns if missing).")
        except Exception as e:
            conn.rollback() 
            print(f"Schema migration skipped or failed (might already exist): {e}")

        # Files Table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS license_files (
                id VARCHAR(255) PRIMARY KEY,
                license_id VARCHAR(255) NOT NULL,
                filename TEXT NOT NULL,
                file_path TEXT NOT NULL,
                upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
            );
        """)

        # Users Table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(255) PRIMARY KEY,
                username VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'user',
                phone_number VARCHAR(100),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Activity Logs Table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS activity_logs (
                id VARCHAR(255) PRIMARY KEY,
                user_id VARCHAR(255),
                username VARCHAR(255),
                action VARCHAR(255),
                details TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Meeting Points Table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS meeting_points (
                id VARCHAR(255) PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                lat FLOAT NOT NULL,
                lng FLOAT NOT NULL,
                address TEXT,
                status VARCHAR(50) DEFAULT 'ACTIVE',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        # Miner Listings Table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS miner_listings (
                id VARCHAR(255) PRIMARY KEY,
                miner_id VARCHAR(255),
                lat FLOAT NOT NULL,
                lng FLOAT NOT NULL,
                photo_url TEXT,
                price_per_kg FLOAT,
                quantity FLOAT,
                shape VARCHAR(100),
                product VARCHAR(100),
                status VARCHAR(50) DEFAULT 'PENDING',
                meeting_point_id VARCHAR(255),
                meeting_date VARCHAR(255),
                meeting_outcome VARCHAR(50),
                communication_log TEXT,
                tested_weight FLOAT,
                tested_purity FLOAT,
                final_offer FLOAT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (meeting_point_id) REFERENCES meeting_points(id) ON DELETE SET NULL,
                FOREIGN KEY (miner_id) REFERENCES users(id) ON DELETE CASCADE
            );
        """)
        
        # Add new columns to existing tables
        try:
            cur.execute("ALTER TABLE miner_listings ADD COLUMN IF NOT EXISTS meeting_date VARCHAR(255);")
            cur.execute("ALTER TABLE miner_listings ADD COLUMN IF NOT EXISTS tested_weight FLOAT;")
            cur.execute("ALTER TABLE miner_listings ADD COLUMN IF NOT EXISTS tested_purity FLOAT;")
            cur.execute("ALTER TABLE miner_listings ADD COLUMN IF NOT EXISTS final_offer FLOAT;")
            cur.execute("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(100);")
            conn.commit()
        except:
            conn.rollback()

        # Oil Trade Flows Table (petroleum / energy context)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS oil_trade_flows (
                id              SERIAL PRIMARY KEY,
                reporter        VARCHAR(255)  NOT NULL,
                reporter_m49    VARCHAR(10),
                reporter_iso2   VARCHAR(5),
                partner         VARCHAR(255)  NOT NULL DEFAULT 'World',
                partner_m49     VARCHAR(10)   DEFAULT '0',
                hs_code         VARCHAR(10)   NOT NULL,
                hs_description  TEXT,
                flow_type       CHAR(1)       NOT NULL,
                year            SMALLINT      NOT NULL,
                trade_value_usd BIGINT,
                net_weight_kg   BIGINT,
                data_source     VARCHAR(80)   NOT NULL DEFAULT 'seed/static',
                ingested_at     TIMESTAMP     DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (reporter_m49, partner_m49, hs_code, flow_type, year)
            );
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_oil_hs_year
                ON oil_trade_flows (hs_code, year);
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_oil_reporter
                ON oil_trade_flows (reporter, year);
        """)

        # Create Default Admin if not exists
        cur.execute("SELECT * FROM users WHERE username = 'admin'")
        if not cur.fetchone():
            admin_id = str(uuid.uuid4())
            admin_hash = get_password_hash("admin123")
            cur.execute(
                "INSERT INTO users (id, username, password_hash, role) VALUES (%s, %s, %s, %s)",
                (admin_id, 'admin', admin_hash, 'admin')
            )
            print("Default admin created: admin / admin123")

        try:
            sync_all_license_contacts, _ = _load_entity_contact_services()
            synced_contacts = sync_all_license_contacts(conn)
            print(f"Entity contact sync completed for {synced_contacts} records.")
        except Exception as contact_exc:
            print(f"Entity contact sync skipped: {contact_exc}")

        conn.commit()
        cur.close()
        conn.close()
        print("Database initialized successfully.")
    except Exception as e:
        print(f"Failed to initialize database: {e}")

# ... existing code ...
# (You need to re-run init_db() call as it was in the original file)
# But since we are replacing the bottom part, carefully reconstruct order.

# Re-call init_db because we updated the definition
init_db()

import threading
import time

def _bootstrap_open_data():
    """One-shot startup bootstrap for live official + fallback sources.

    Historical behaviour deleted the entire table every day and reloaded a
    bundled JSON file. That kept the app pinned to imported snapshot data.
    The new bootstrap keeps the existing schema/UI intact, upserts official
    open-data rows plus configured global fallback datasets, and only falls
    back to the bundled JSON if all live source fetches fail.
    """
    time.sleep(3)

    try:
        try:
            from backend.services.ingest.open_data_sync import sync_open_data_sources, seed_bundled_json_fallback
        except ImportError:
            from services.ingest.open_data_sync import sync_open_data_sources, seed_bundled_json_fallback

        summary = sync_open_data_sources()
        print(
            f"[OpenData] Synced {summary.get('records_written', 0)} normalized records "
            f"from {len(summary.get('sources', []))} configured sources."
        )
        for error in summary.get("errors", []):
            print(f"[OpenData] Source warning: {error}")

        if not summary.get("records_written"):
            conn = get_db_connection()
            try:
                inserted = seed_bundled_json_fallback(conn)
                print(f"[OpenData] No live sources succeeded. Seeded bundled fallback rows: {inserted}")
            finally:
                conn.close()

        try:
            from ingest_oil_trades import ingest as ingest_oil_trades
            oil_summary = ingest_oil_trades(seed_only=True)
            print(
                f"[OpenData] Oil trade context seeded with "
                f"{oil_summary.get('seed_rows_written', 0)} rows."
            )
        except Exception as exc:
            print(f"[OpenData] Oil trade seeding skipped: {exc}")

        try:
            try:
                from backend.services.storage_terminals import get_storage_terminals as warm_storage_terminals
            except ImportError:
                from services.storage_terminals import get_storage_terminals as warm_storage_terminals
            storage_summary = warm_storage_terminals(force_refresh=False)
            print(
                f"[OpenData] Storage terminal cache ready with "
                f"{storage_summary.get('stats', {}).get('total', 0)} entities."
            )
        except Exception as exc:
            print(f"[OpenData] Storage terminal warmup skipped: {exc}")
    except Exception as exc:
        print(f"[OpenData] Bootstrap failed: {exc}")


threading.Thread(target=_bootstrap_open_data, daemon=True).start()

# --- Auth Endpoints ---

@app.post("/auth/login")
def login(user: UserLogin):
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    try:
        c.execute("SELECT * FROM users WHERE username = %s", (user.username,))
        db_user = c.fetchone()
        
        if not db_user or not verify_password(user.password, db_user['password_hash']):
            return Response("Invalid credentials", status_code=401)
            
        access_token = create_access_token(data={"sub": db_user['username'], "role": db_user['role'], "id": db_user['id']})
        return {
            "access_token": access_token, 
            "token_type": "bearer",
            "username": db_user['username'],
            "role": db_user['role'],
            "id": db_user['id']
        }
    finally:
        conn.close()

@app.post("/auth/register")
def register(user: UserCreate):
    # In a real app, check for Admin token here. For MVP, we'll assume the frontend enforces 'Admin Panel' access.
    # ideally verify jwt token from header.
    
    conn = get_db_connection()
    c = conn.cursor()
    try:
        # Check if username exists
        c.execute("SELECT id FROM users WHERE username = %s", (user.username,))
        if c.fetchone():
            return Response("Username already taken", status_code=400)

        user_id = str(uuid.uuid4())
        hashed = get_password_hash(user.password)
        
        c.execute(
            "INSERT INTO users (id, username, password_hash, role) VALUES (%s, %s, %s, %s)",
            (user_id, user.username, hashed, user.role)
        )
        conn.commit()
        return {"status": "success", "username": user.username, "role": user.role}
    except Exception as e:
        return Response(f"Error: {str(e)}", status_code=500)
    finally:
        conn.close()

@app.get("/auth/users")
def get_users():
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    try:
        c.execute("SELECT id, username, role, created_at FROM users ORDER BY created_at DESC")
        return c.fetchall()
    finally:
        conn.close()

class UserUpdate(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    role: Optional[str] = None

@app.delete("/auth/users/{user_id}")
def delete_user(user_id: str, authorization: Optional[str] = Header(None)):
    payload, err = _admin_payload_from_authorization(authorization)
    if err:
        return err
    actor_id = payload.get("id")
    if actor_id is not None and str(actor_id) == str(user_id):
        return Response("Cannot delete your own account", status_code=400)

    conn = get_db_connection()
    c = conn.cursor()
    try:
        c.execute("SELECT role FROM users WHERE id = %s", (user_id,))
        row = c.fetchone()
        if not row:
            return Response("User not found", status_code=404)
        if row[0] == "admin":
            c.execute("SELECT COUNT(*) FROM users WHERE role = %s", ("admin",))
            if c.fetchone()[0] <= 1:
                return Response("Cannot delete the last admin user", status_code=400)
        c.execute("DELETE FROM users WHERE id = %s", (user_id,))
        conn.commit()
        return {"status": "deleted"}
    except Exception as e:
        conn.rollback()
        return Response(str(e), status_code=500)
    finally:
        conn.close()

@app.put("/auth/users/{user_id}")
def update_user(user_id: str, user: UserUpdate):
    conn = get_db_connection()
    c = conn.cursor()
    try:
        updates = []
        values = []
        
        if user.username:
            updates.append("username = %s")
            values.append(user.username)
        
        if user.password:
            hashed = get_password_hash(user.password)
            updates.append("password_hash = %s")
            values.append(hashed)
            
        if user.role:
            updates.append("role = %s")
            values.append(user.role)
            
        if not updates:
            return {"status": "no changes"}
            
        values.append(user_id)
        sql = f"UPDATE users SET {', '.join(updates)} WHERE id = %s"
        
        c.execute(sql, tuple(values))
        conn.commit()
        return {"status": "updated"}
    except Exception as e:
        return Response(str(e), status_code=500)
    finally:
        conn.close()

# --- Activity Logging ---

@app.post("/activity/log")
def log_activity(log: LogCreate):
    conn = get_db_connection()
    c = conn.cursor()
    try:
        log_id = str(uuid.uuid4())
        c.execute(
            "INSERT INTO activity_logs (id, user_id, username, action, details) VALUES (%s, %s, %s, %s, %s)",
            (log_id, log.user_id, log.username, log.action, log.details)
        )
        conn.commit()
        return {"status": "logged"}
    except Exception as e:
        print(f"Logging failed: {e}")
        # Don't fail the request if logging fails, just print error
        return {"status": "failed", "error": str(e)}
    finally:
        conn.close()

@app.get("/activity/logs")
def get_logs(limit: int = 100):
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    try:
        c.execute("SELECT * FROM activity_logs ORDER BY timestamp DESC LIMIT %s", (limit,))
        return c.fetchall()
    finally:
        conn.close()

@app.get("/activity/logs/user/{user_id}")
def get_user_logs(user_id: str, limit: int = 100):
    """Get activity logs for a specific user"""
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    try:
        c.execute(
            "SELECT * FROM activity_logs WHERE user_id = %s ORDER BY timestamp DESC LIMIT %s",
            (user_id, limit)
        )
        return c.fetchall()
    finally:
        conn.close()



@app.get("/licenses")
def read_licenses(sector: Optional[str] = None, prefer_open_data: bool = True):
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    
    # Select all rows
    try:
        c.execute("SELECT * FROM licenses")
        rows = c.fetchall()
        cached_geo = _load_cached_geo_fallbacks(c, rows)
    except Exception as e:
        conn.close()
        return {"error": f"Database error: {str(e)}"}
    
    conn.close()

    normalized_sector = (sector or "").strip().lower()
    if normalized_sector:
        rows = [
            row for row in rows
            if (row.get("sector") or "mining").strip().lower() == normalized_sector
        ]

    # Once live/open or global fallback rows exist for the current sector, hide
    # the old bundled JSON snapshot rows from the primary map feed. Manual /
    # CSV imports remain visible because they are user-supplied.
    preferred_live_origins = {"open_data", "global_open_fallback"}
    has_preferred_live_rows = any((row.get("record_origin") or "").lower() in preferred_live_origins for row in rows)
    if prefer_open_data and has_preferred_live_rows:
        rows = [
            row for row in rows
            if (row.get("record_origin") or "").lower() != "bundled_json"
        ]

    try:
        try:
            from backend.services.ingest.open_data_sync import describe_license_source_record
        except ImportError:
            from services.ingest.open_data_sync import describe_license_source_record
    except Exception:
        describe_license_source_record = None

    # Transform to list of dicts with keys matching what the Reac app expects
    results = []
    for row in rows:
        keys = row.keys()
        display_lat, display_lng, display_geo_source, display_geo_approximated, display_geo_confidence = _license_display_coords(row, cached_geo)
        provenance = (
            describe_license_source_record(
                row["source_id"] if "source_id" in keys else None,
                row["record_origin"] if "record_origin" in keys else None,
            )
            if describe_license_source_record
            else {}
        )
        results.append({
            "id": row["id"],
            "company": row["company"],
            "licenseType": row["license_type"], # Frontend expects camelCase
            "commodity": row["commodity"],
            "status": row["status"],
            "date": row["date_issued"],        # Frontend expects 'date'
            "country": row["country"],
            "region": row["region"],
            "sector": row["sector"] if "sector" in keys and row["sector"] else "mining",
            "lat": display_lat,
            "lng": display_lng,
            "phoneNumber": row["phone_number"] if "phone_number" in keys else None,
            "contactPerson": row["contact_person"] if "contact_person" in keys else None,
            "recordOrigin": row["record_origin"] if "record_origin" in keys else None,
            "sourceId": row["source_id"] if "source_id" in keys else None,
            "sourceName": row["source_name"] if "source_name" in keys else None,
            "sourceUrl": row["source_url"] if "source_url" in keys else None,
            "sourceRecordUrl": row["source_record_url"] if "source_record_url" in keys else None,
            "sourceUpdatedAt": row["source_updated_at"] if "source_updated_at" in keys else None,
            "lastSyncedAt": row["last_synced_at"] if "last_synced_at" in keys else None,
            "sourceKind": provenance.get("source_kind"),
            "sourceAccess": provenance.get("source_access"),
            "coverageState": provenance.get("coverage_state"),
            "provenanceNote": provenance.get("provenance_note"),
            "entityKind": "license",
            # Geocoding provenance — read-only on the frontend; drives the
            # "≈ approx location" badge and lets users distinguish surveyed
            # points from district-centroid backfills.
            "geoSource": display_geo_source if "geo_source" in keys else None,
            "geoApproximated": display_geo_approximated if "geo_approximated" in keys else None,
            "geoConfidence": display_geo_confidence if "geo_confidence" in keys else None,
            "originalLat": row["original_lat"] if "original_lat" in keys else None,
            "originalLng": row["original_lng"] if "original_lng" in keys else None,
        })
    
    return results


@app.get("/entities/{entity_id:path}/contacts")
def read_entity_contacts(entity_id: str, entity_kind: str = "license"):
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if (entity_kind or "").strip().lower() == "license":
            _, sync_license_contacts = _load_entity_contact_services()
            sync_license_contacts(conn, entity_id)
            conn.commit()

        c.execute(
            """
            SELECT
                id,
                entity_kind,
                entity_id,
                contact_type,
                contact_scope,
                label,
                value,
                source_name,
                source_url,
                source_type,
                confidence_score,
                raw_payload,
                extracted_from,
                verified_at,
                last_seen_at
            FROM entity_contacts
            WHERE entity_id = %s
              AND entity_kind = %s
            ORDER BY
                CASE contact_type
                    WHEN 'phone' THEN 1
                    WHEN 'email' THEN 2
                    WHEN 'website' THEN 3
                    WHEN 'address' THEN 4
                    ELSE 5
                END,
                confidence_score DESC NULLS LAST,
                value ASC
            """,
            (entity_id, entity_kind),
        )
        return [_serialize_entity_contact(row) for row in c.fetchall()]
    except Exception as e:
        conn.rollback()
        return Response(str(e), status_code=500)
    finally:
        conn.close()


@app.get("/entities/{entity_id:path}/dd/latest")
def read_latest_dd_report(entity_id: str, entity_kind: str = "license"):
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    try:
        c.execute(
            """
            SELECT
                id,
                entity_kind,
                entity_id,
                status,
                provider,
                model,
                extraction_provider,
                extraction_model,
                prompt_version,
                analysis_text,
                source_snapshot,
                extracted_contacts,
                promoted_contacts,
                created_at
            FROM dd_reports
            WHERE entity_id = %s
              AND entity_kind = %s
            ORDER BY created_at DESC, id DESC
            LIMIT 1
            """,
            (entity_id, entity_kind),
        )
        row = c.fetchone()
        return _serialize_dd_report(row) if row else None
    except Exception as e:
        return Response(str(e), status_code=500)
    finally:
        conn.close()


@app.get("/entities/{entity_id:path}/relationships")
def read_entity_relationships(entity_id: str, entity_kind: str = "license"):
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if (entity_kind or "").strip().lower() == "license":
            _, sync_license_relationships = _load_entity_relationship_services()
            sync_license_relationships(conn, entity_id)
            conn.commit()

        c.execute(
            """
            SELECT
                COALESCE(fingerprint, id::text) AS id,
                source_entity_kind,
                source_entity_ref,
                target_entity_kind,
                target_entity_ref,
                target_name,
                COALESCE(relationship_type, rel_type) AS relationship_type,
                relationship_label,
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
            FROM entity_relationships
            WHERE source_entity_ref = %s
              AND source_entity_kind = %s
            ORDER BY
                CASE COALESCE(relationship_type, rel_type)
                    WHEN 'beneficial_owner' THEN 1
                    WHEN 'parent_company' THEN 2
                    WHEN 'subsidiary' THEN 3
                    WHEN 'owner' THEN 4
                    WHEN 'license_holder' THEN 5
                    WHEN 'operator' THEN 6
                    WHEN 'manager' THEN 7
                    WHEN 'charterer' THEN 8
                    WHEN 'trader' THEN 9
                    WHEN 'counterparty' THEN 10
                    ELSE 99
                END,
                confidence_score DESC NULLS LAST,
                COALESCE(target_name, '') ASC
            """,
            (entity_id, entity_kind),
        )
        return [_serialize_entity_relationship(row) for row in c.fetchall()]
    except Exception as e:
        conn.rollback()
        return Response(str(e), status_code=500)
    finally:
        conn.close()


@app.get("/api/map/country-borders")
def read_country_borders(
    countries: Optional[str] = None,
    if_none_match: Optional[str] = Header(None),
):
    try:
        requested = parse_requested_countries(countries)
        payload, etag = get_country_borders_geojson(requested)
    except FileNotFoundError:
        raise HTTPException(
            status_code=503,
            detail="Country borders dataset is missing on the backend. Regenerate backend/data/country_borders.geojson.",
        )
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=f"Invalid country borders dataset: {exc}")

    headers = {
        "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        "ETag": etag,
    }
    if if_none_match == etag:
        return Response(status_code=304, headers=headers)

    return Response(
        content=json.dumps(payload, ensure_ascii=True),
        media_type="application/geo+json",
        headers=headers,
    )

class LicenseCreate(BaseModel):
    company: str
    country: str
    region: Optional[str] = None
    commodity: Optional[str] = None
    licenseType: Optional[str] = None
    status: Optional[str] = 'Operating'
    lat: Optional[float] = None
    lng: Optional[float] = None
    phoneNumber: Optional[str] = None
    contactPerson: Optional[str] = None

@app.post("/licenses")
def create_license(item: LicenseCreate):
    conn = get_db_connection()
    c = conn.cursor()
    
    # Generate a simple ID or use uuid usually, but let's use a random string/int for now or max+1
    # Let's use uuid for uniqueness
    import uuid
    new_id = str(uuid.uuid4())
    
    c.execute('''
        INSERT INTO licenses 
        (id, company, country, region, commodity, license_type, status, lat, lng, phone_number, contact_person, date_issued)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
    ''', (
        new_id, item.company, item.country, item.region, item.commodity, 
        item.licenseType, item.status, item.lat, item.lng, 
        item.phoneNumber, item.contactPerson, None
    ))
    try:
        _, sync_license_contacts = _load_entity_contact_services()
        sync_license_contacts(conn, new_id)
    except Exception as contact_exc:
        print(f"Entity contact sync skipped for {new_id}: {contact_exc}")
    conn.commit()
    conn.close()
    
    return {
        "id": new_id,
        "company": item.company,
        "country": item.country,
        "region": item.region,
        "commodity": item.commodity,
        "licenseType": item.licenseType,
        "status": item.status,
        "lat": item.lat,
        "lng": item.lng,
        "phoneNumber": item.phoneNumber,
        "contactPerson": item.contactPerson,
        "date": None
    }

# --- Marketplace Export Logic ---
import requests

MARKETPLACE_API_URL = os.getenv("MARKETPLACE_API_URL", "http://host.docker.internal:3001/api/v1/ingest")
MARKETPLACE_API_KEY = os.getenv("MARKETPLACE_API_KEY", "demo-key")

def export_license_to_marketplace(license_data: dict):
    print(f"Attempting export for license {license_data['id']}...")
    try:
        # Map fields to Marketplace Seller Object
        payload = {
            "externalId": license_data["id"],
            "company": license_data["company"],
            "commodity": license_data["commodity"],
            "quantity": license_data.get("capacity", 0),  # Mapping capacity to quantity for now
            "pricePerKg": license_data.get("price_per_kg", 0),
            "discount": 5.0, # Hardcoded discount for demo, or add to DB
            "status": "OPEN"
        }
        
        # In a real scenario, we would POST to the API
        response = requests.post(MARKETPLACE_API_URL, json=payload, timeout=5)
        response.raise_for_status()
        
        print(f"EXPORT SUCCESS: Exported {license_data['company']} to Marketplace as PASSIVE seller.")
        return True
    except Exception as e:
        print(f"EXPORT FAILED: {e}")
        return False

# NEW: Update Model and Endpoint
class LicenseUpdate(BaseModel):
    company: Optional[str] = None
    country: Optional[str] = None
    region: Optional[str] = None
    commodity: Optional[str] = None
    licenseType: Optional[str] = None
    status: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    phoneNumber: Optional[str] = None
    contactPerson: Optional[str] = None
    pricePerKg: Optional[float] = None
    capacity: Optional[float] = None

@app.put("/licenses/{license_id}")
def update_license(license_id: str, item: LicenseUpdate):
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        # Check if license exists
        c.execute("SELECT * FROM licenses WHERE id = %s", (license_id,))
        existing = c.fetchone()
        if not existing:
            return Response("License not found", status_code=404)

        updates = []
        values = []
        
        # Dynamic Update Query Construction
        if item.company is not None:
            updates.append("company = %s"); values.append(item.company)
        if item.country is not None:
            updates.append("country = %s"); values.append(item.country)
        if item.region is not None:
             updates.append("region = %s"); values.append(item.region)
        if item.commodity is not None:
             updates.append("commodity = %s"); values.append(item.commodity)
        if item.licenseType is not None:
             updates.append("license_type = %s"); values.append(item.licenseType)
        if item.status is not None:
             updates.append("status = %s"); values.append(item.status)
        if item.lat is not None:
             updates.append("lat = %s"); values.append(item.lat)
        if item.lng is not None:
             updates.append("lng = %s"); values.append(item.lng)
        if item.phoneNumber is not None:
             updates.append("phone_number = %s"); values.append(item.phoneNumber)
        if item.contactPerson is not None:
             updates.append("contact_person = %s"); values.append(item.contactPerson)
        if item.pricePerKg is not None:
             updates.append("price_per_kg = %s"); values.append(item.pricePerKg)
        if item.capacity is not None:
             updates.append("capacity = %s"); values.append(item.capacity)

        if not updates:
            return {"status": "no changes"}
            
        values.append(license_id)
        sql = f"UPDATE licenses SET {', '.join(updates)} WHERE id = %s"
        c.execute(sql, tuple(values))
        
        # --- EXPORT TRIGGER LOGIC ---
        # Trigger: Status is APPROVED (either newly set or existing, but typically newly set)
        # Idempotency: Check 'is_exported' flag
        
        # We need to know the FINAL status. 
        # If item.status was passed, use it. If not, use existing['status']
        final_status = item.status if item.status is not None else existing['status']
        already_exported = existing['is_exported']
        
        if final_status == 'APPROVED' and not already_exported:
            # Gather all data for export (merge existing with updates)
            # Simplest is to just use what we have, or re-fetch. Re-fetching is safer.
            try:
                _, sync_license_contacts = _load_entity_contact_services()
                sync_license_contacts(conn, license_id)
            except Exception as contact_exc:
                print(f"Entity contact sync skipped for {license_id}: {contact_exc}")
            conn.commit() # Commit the update first
            
            c.execute("SELECT * FROM licenses WHERE id = %s", (license_id,))
            updated_row = c.fetchone()
            
            if export_license_to_marketplace(updated_row):
                c.execute("UPDATE licenses SET is_exported = TRUE WHERE id = %s", (license_id,))
                conn.commit()
                return {"status": "updated", "exported": True}
        else:
            try:
                _, sync_license_contacts = _load_entity_contact_services()
                sync_license_contacts(conn, license_id)
            except Exception as contact_exc:
                print(f"Entity contact sync skipped for {license_id}: {contact_exc}")
            conn.commit()

        return {"status": "updated", "exported": False}
        
    except Exception as e:
        conn.rollback()
        return Response(str(e), status_code=500)
    finally:
        conn.close()

@app.delete("/licenses/{license_id:path}")
def delete_license(license_id: str):
    print(f"Deleting license with ID: '{license_id}'")
    
    conn = get_db_connection()
    c = conn.cursor()
    
    # Check if exists first for debugging
    c.execute("SELECT * FROM licenses WHERE id = %s", (license_id,))
    found = c.fetchone()
    print(f"Record found before delete: {found is not None}")
    if found:
        print(f"Record: {tuple(found)}")

    c.execute("DELETE FROM licenses WHERE id = %s", (license_id,))
    conn.commit()
    deleted = c.rowcount
    print(f"Rows deleted: {deleted}")
    conn.close()
    
    if deleted == 0:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"License {license_id} not found")
        
    return {"status": "success", "deleted_id": license_id}

class BatchDeleteRequest(BaseModel):
    ids: list[str]

@app.post("/licenses/batch-delete")
def batch_delete_licenses(request: BatchDeleteRequest):
    print(f"Batch deleting {len(request.ids)} licenses")
    
    if not request.ids:
        return {"status": "success", "deleted_count": 0}

    conn = get_db_connection()
    c = conn.cursor()
    
    # Create placeholders for IN clause
    placeholders = ','.join(['%s'] * len(request.ids))
    sql = f"DELETE FROM licenses WHERE id IN ({placeholders})"
    
    try:
        c.execute(sql, tuple(request.ids))
        conn.commit()
        deleted_count = c.rowcount
        print(f"Total rows deleted: {deleted_count}")
    except Exception as e:
        conn.rollback()
        print(f"Error batch deleting: {e}")
        conn.close()
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail=str(e))
        
    conn.close()
    return {"status": "success", "deleted_count": deleted_count}

# --- License bulk import (CSV): shared parsing + validation ----------------------------

_LICENSE_IMPORT_HEADER_ALIASES: dict[str, str] = {
    "company": "company",
    "country": "country",
    "region": "region",
    "commodity": "commodity",
    "main_commodity": "commodity",
    "maincommodity": "commodity",
    "license_type": "license_type",
    "licensetype": "license_type",
    "status": "status",
    "lat": "lat",
    "latitude": "lat",
    "lng": "lng",
    "lon": "lng",
    "long": "lng",
    "longitude": "lng",
    "location": "location",
    "place": "location",
    "site": "location",
    "area": "location",
    "phone_number": "phone_number",
    "phonenumber": "phone_number",
    "phone": "phone_number",
    "contact_person": "contact_person",
    "contactperson": "contact_person",
    "contact": "contact_person",
}


def _strip_bom(text: str) -> str:
    t = text.strip()
    if t.startswith("\ufeff"):
        return t[1:]
    return t


def _canon_csv_header(cell: str) -> Optional[str]:
    if cell is None:
        return None
    key = cell.strip().lower().replace(" ", "_")
    return _LICENSE_IMPORT_HEADER_ALIASES.get(key)


def parse_license_import_csv(decoded: str) -> dict:
    """
    Parse license bulk-import CSV. First row must be headers.
    Required: company, country, and either (lat + lng) or location — see LICENSE_BULK_IMPORT.md.
    Returns: { "ok": bool, "rows": [... tuples for executemany ...], "errors": [ {"row": int, "message": str}, ... ] }
    """
    text = _strip_bom(decoded)
    if not text:
        return {"ok": False, "rows": [], "errors": [{"row": 0, "message": "Empty CSV"}]}

    stream = io.StringIO(text)
    reader = csv.reader(stream)
    try:
        header_cells = next(reader)
    except StopIteration:
        return {"ok": False, "rows": [], "errors": [{"row": 0, "message": "Missing header row"}]}

    col_map: list[Optional[str]] = []
    for h in header_cells:
        canon = _canon_csv_header(h or "")
        col_map.append(canon)

    present = {c for c in col_map if c}
    if "company" not in present or "country" not in present:
        return {
            "ok": False,
            "rows": [],
            "errors": [
                {
                    "row": 1,
                    "message": "Missing required columns: company and country must appear in the header row.",
                }
            ],
        }
    has_lat_lng = "lat" in present and "lng" in present
    has_location = "location" in present
    if not has_lat_lng and not has_location:
        return {
            "ok": False,
            "rows": [],
            "errors": [
                {
                    "row": 1,
                    "message": "Include either columns lat and lng, or a location column (CSV may use place/site aliases). "
                    "See GET /licenses/template and LICENSE_BULK_IMPORT.md.",
                }
            ],
        }

    rows_out: list[tuple] = []
    errors: list[dict] = []
    row_num = 1

    for parts in reader:
        row_num += 1
        if not parts or all(not (c or "").strip() for c in parts):
            continue

        row_data: dict[str, str] = {}
        for idx, raw in enumerate(parts):
            if idx >= len(col_map):
                break
            field = col_map[idx]
            if not field:
                continue
            row_data[field] = (raw or "").strip()

        company = row_data.get("company", "")
        country = row_data.get("country", "")
        lat_s = row_data.get("lat", "") if has_lat_lng else ""
        lng_s = row_data.get("lng", "") if has_lat_lng else ""
        loc_s = row_data.get("location", "") if has_location else ""

        row_errors: list[str] = []
        if not company:
            row_errors.append("company is required")
        if not country:
            row_errors.append("country is required")

        lat: Optional[float] = None
        lng: Optional[float] = None

        if lat_s or lng_s:
            if not lat_s:
                row_errors.append("lat is required when lng is provided")
            if not lng_s:
                row_errors.append("lng is required when lat is provided")

        if not row_errors and lat_s and lng_s:
            try:
                lat = float(lat_s)
                lng = float(lng_s)
            except ValueError:
                errors.append(
                    {
                        "row": row_num,
                        "message": f"lat and lng must be valid numbers (got lat={lat_s!r}, lng={lng_s!r})",
                    }
                )
                continue
            rng = validate_lat_lng_range(lat, lng)
            if rng:
                errors.append({"row": row_num, "message": rng})
                continue

        elif not row_errors and loc_s:
            resolved = resolve_location_to_coords(loc_s, country)
            if resolved is None:
                errors.append(
                    {
                        "row": row_num,
                        "message": "Could not get coordinates from location: use lat/lng, "
                        "put decimal degrees in the location column (e.g. 6.5,-1.5), "
                        "or for Ghana use a known region/district label from the import lookup table "
                        "(see LICENSE_BULK_IMPORT.md).",
                    }
                )
                continue
            lat, lng, _how = resolved
            rng = validate_lat_lng_range(lat, lng)
            if rng:
                errors.append({"row": row_num, "message": rng})
                continue
        elif not row_errors:
            row_errors.append(
                "provide both lat and lng, or a non-empty location (coordinates or Ghana place name)"
            )

        if row_errors:
            errors.append({"row": row_num, "message": "; ".join(row_errors)})
            continue

        if lat is None or lng is None:
            errors.append({"row": row_num, "message": "Internal parse error: coordinates missing"})
            continue

        region = row_data.get("region", "") or ""
        if not region.strip() and loc_s:
            region = loc_s.splitlines()[0].strip()

        commodity = row_data.get("commodity", "") or ""
        license_type = (row_data.get("license_type", "") or "").strip() or "Unknown"
        status = (row_data.get("status", "") or "").strip() or "Operating"
        phone_number = row_data.get("phone_number", "") or ""
        contact_person = row_data.get("contact_person", "") or ""

        rows_out.append(
            (
                str(uuid.uuid4()),
                company,
                country,
                region,
                commodity,
                license_type,
                status,
                lat,
                lng,
                phone_number,
                contact_person,
                None,
            )
        )

    if not rows_out:
        if errors:
            return {"ok": False, "rows": [], "errors": errors}
        return {"ok": False, "rows": [], "errors": [{"row": 0, "message": "No data rows after header"}]}

    if errors:
        return {"ok": False, "rows": [], "errors": errors}

    return {"ok": True, "rows": rows_out, "errors": []}


def _insert_license_import_rows(rows: list[tuple]) -> int:
    conn = get_db_connection()
    c = conn.cursor()
    try:
        c.executemany(
            """
            INSERT INTO licenses
            (id, company, country, region, commodity, license_type, status, lat, lng, phone_number, contact_person, date_issued)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            rows,
        )
        conn.commit()
        return len(rows)
    except Exception as e:
        conn.rollback()
        raise HTTPException(status_code=500, detail={"message": str(e)})
    finally:
        conn.close()


class LicenseImportTextBody(BaseModel):
    csv: str


@app.post("/licenses/import-text")
def import_licenses_text(body: LicenseImportTextBody):
    """Bulk-import licenses from raw CSV text (for mobile paste). Same rules as POST /licenses/import."""
    result = parse_license_import_csv(body.csv)
    if not result["ok"]:
        raise HTTPException(
            status_code=422,
            detail={"status": "validation_error", "errors": result["errors"]},
        )
    imported = _insert_license_import_rows(result["rows"])
    return {"status": "success", "imported_count": imported}


@app.get("/licenses/export")
def export_licenses():
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    c.execute(
        """
        SELECT
            licenses.*,
            public_phone.value AS public_business_phone,
            public_phone.source_name AS public_business_phone_source,
            public_phone.source_type AS public_business_phone_source_type
        FROM licenses
        LEFT JOIN LATERAL (
            SELECT
                value,
                source_name,
                source_type
            FROM entity_contacts
            WHERE entity_id = licenses.id
              AND entity_kind = 'license'
              AND contact_type = 'phone'
              AND contact_scope = 'public_business'
            ORDER BY
                CASE source_type
                    WHEN 'official_open_data' THEN 1
                    WHEN 'source_backed_record' THEN 2
                    WHEN 'llm_extracted_from_source' THEN 3
                    ELSE 4
                END,
                confidence_score DESC NULLS LAST,
                last_seen_at DESC NULLS LAST
            LIMIT 1
        ) AS public_phone ON TRUE
        """
    )
    rows = c.fetchall()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    
    # Write Header
    headers = [
        "id",
        "company",
        "country",
        "region",
        "commodity",
        "license_type",
        "status",
        "lat",
        "lng",
        "phone_number",
        "contact_person",
        "public_business_phone",
        "public_business_phone_source",
        "public_business_phone_source_type",
        "date_issued",
    ]
    writer.writerow(headers)
    
    # Write Data
    for row in rows:
        writer.writerow([
            row["id"], row["company"], row["country"], row["region"], row["commodity"], 
            row["license_type"], row["status"], row["lat"], row["lng"], 
            row["phone_number"], row["contact_person"], row["public_business_phone"],
            row["public_business_phone_source"], row["public_business_phone_source_type"],
            row["date_issued"]
        ])
    
    output.seek(0)
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=licenses_export.csv"
    return response

@app.get("/licenses/template")
def get_template():
    output = io.StringIO()
    writer = csv.writer(output)
    # Required: company, country, and either (lat + lng) or location — see LICENSE_BULK_IMPORT.md
    headers = [
        "company",
        "country",
        "region",
        "commodity",
        "license_type",
        "status",
        "lat",
        "lng",
        "location",
        "phone_number",
        "contact_person",
    ]
    writer.writerow(headers)
    writer.writerow(
        ["Example Mining Co", "Ghana", "Ashanti", "Gold", "Large Scale", "Operating", "6.5", "-1.5", "", "+233...", "John Doe"]
    )
    writer.writerow(
        ["Regional Holdings", "Ghana", "", "Gold", "Small Scale", "Operating", "", "", "Western Region", "", ""]
    )
    
    output.seek(0)
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=import_template.csv"
    return response

@app.post("/licenses/import")
async def import_licenses(file: UploadFile = File(...)):
    content = await file.read()
    try:
        decoded = content.decode("utf-8")
    except UnicodeDecodeError:
        decoded = content.decode("latin-1")

    result = parse_license_import_csv(decoded)
    if not result["ok"]:
        raise HTTPException(
            status_code=422,
            detail={"status": "validation_error", "errors": result["errors"]},
        )
    imported = _insert_license_import_rows(result["rows"])
    return {"status": "success", "imported_count": imported}

# --- File Management for Dossiers ---
from fastapi.staticfiles import StaticFiles

# Ensure upload directory exists
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "/data/uploads")
if not os.path.exists(UPLOAD_DIR):
    try:
        os.makedirs(UPLOAD_DIR)
    except Exception as e:
        print(f"Warning: Could not create upload dir {UPLOAD_DIR}: {e}")
        # Fallback for local dev if /data doesn't exist
        UPLOAD_DIR = "uploads"
        os.makedirs(UPLOAD_DIR, exist_ok=True)

# Mount it so we can serve files (add authentication in real prod if sensitive)
app.mount("/files", StaticFiles(directory=UPLOAD_DIR), name="files")

@app.post("/licenses/{license_id:path}/files")
async def upload_license_file(license_id: str, file: UploadFile = File(...)):
    conn = get_db_connection()
    c = conn.cursor()
    
    # Verify license exists
    c.execute("SELECT id FROM licenses WHERE id = %s", (license_id,))
    if not c.fetchone():
        conn.close()
        return Response("License not found", status_code=404)

    file_id = str(uuid.uuid4())
    # Secure filename - replace spaces with underscores first
    safe_filename = file.filename.replace(" ", "_")
    safe_filename = "".join(x for x in safe_filename if x.isalnum() or x in "._-")
    if not safe_filename:
        safe_filename = "unnamed_file"
        
    final_path = os.path.join(UPLOAD_DIR, f"{file_id}_{safe_filename}")
    
    try:
        with open(final_path, "wb") as buffer:
            import shutil
            shutil.copyfileobj(file.file, buffer)
            
        c.execute("""
            INSERT INTO license_files (id, license_id, filename, file_path)
            VALUES (%s, %s, %s, %s)
        """, (file_id, license_id, file.filename, f"/files/{file_id}_{safe_filename}"))
        
        conn.commit()
    except Exception as e:
        conn.close()
        return {"error": str(e)}
        
    conn.close()
    return {
        "id": file_id,
        "filename": file.filename,
        "url": f"/files/{file_id}_{safe_filename}"
    }

@app.get("/licenses/{license_id:path}/files")
def get_license_files(license_id: str):
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    try:
        c.execute("SELECT * FROM license_files WHERE license_id = %s ORDER BY upload_date DESC", (license_id,))
        files = c.fetchall()
        # Ensure we return valid URLs
        result = []
        for f in files:
            result.append({
                "id": f["id"],
                "filename": f["filename"],
                "url": f["file_path"], # In our case file_path stores the relative URL
                "date": f["upload_date"]
            })
        return result
    except Exception as e:
        return {"error": str(e)}
    finally:
        conn.close()

@app.delete("/files/{file_id}")
def delete_file(file_id: str):
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    
    try:
        c.execute("SELECT file_path FROM license_files WHERE id = %s", (file_id,))
        row = c.fetchone()
        
        if row:
            # Try to delete from disk
            # URL is like /files/GUID_name, we need partial relative path
            relative_name = row['file_path'].replace("/files/", "")
            full_path = os.path.join(UPLOAD_DIR, relative_name)
            if os.path.exists(full_path):
                os.remove(full_path)
                
        c.execute("DELETE FROM license_files WHERE id = %s", (file_id,))
        conn.commit()
        return {"status": "deleted"}
    except Exception as e:
        return Response(str(e), status_code=500)
    finally:
        conn.close()

# --- AI Analysis Endpoint (Free via Pollinations.ai) ---

# --- AI Intelligence Waterfall (Groq, OpenRouter, AwanLLM) ---

class AIRequest(BaseModel):
    query: str
    context: Optional[dict] = None

@app.post("/api/ai/analyze")
def analyze_with_ai(request: AIRequest):
    """
    Executes the AI DD pipeline.
    For dossier runs we persist the rendered analysis plus any structured,
    source-backed contact extraction for future reuse.
    """
    generate_dd_report, build_promotable_contact_candidates = _load_dd_services()
    _, upsert_entity_contact_candidates = _load_entity_contact_helpers()

    context = request.context or {}
    entity_kind = (context.get("entity_kind") or context.get("entityKind") or "license").strip().lower()
    entity_id = context.get("item_id") or context.get("itemId") or context.get("entity_id") or context.get("entityId")
    should_persist = context.get("type") == "DOSSIER" and bool(entity_id)

    conn = None
    try:
        source_snapshot = None
        source_summary = {}
        if should_persist:
            conn = get_db_connection()
            if entity_kind == "license":
                source_snapshot = _load_license_dd_snapshot(conn, entity_id)
            if isinstance(source_snapshot, dict):
                source_summary = source_snapshot.get("source") if isinstance(source_snapshot.get("source"), dict) else {}

        report = generate_dd_report(request.query, source_snapshot)
        if report.get("status") != "success" or not report.get("analysis"):
            return {"status": "error", "message": report.get("message") or "All intelligence providers are offline."}

        serialized_report = None
        if should_persist and conn is not None:
            report_id = str(uuid.uuid4())
            promoted_candidates = build_promotable_contact_candidates(
                entity_kind=entity_kind,
                entity_id=entity_id,
                extracted_contacts=report.get("extracted_contacts", []),
                default_source_name=source_summary.get("source_name"),
                default_source_url=source_summary.get("source_record_url") or source_summary.get("source_url"),
                report_id=report_id,
            )
            if promoted_candidates:
                upsert_entity_contact_candidates(conn, promoted_candidates)

            annotated_contacts = _annotate_dd_contacts(
                report.get("extracted_contacts", []),
                promoted_candidates,
                default_source_name=source_summary.get("source_name"),
                default_source_url=source_summary.get("source_record_url") or source_summary.get("source_url"),
            )
            promoted_contacts_payload = [
                {
                    "id": candidate.get("id"),
                    "contactType": candidate.get("contact_type"),
                    "value": candidate.get("value"),
                    "sourceName": candidate.get("source_name"),
                    "sourceUrl": candidate.get("source_url"),
                    "sourceType": candidate.get("source_type"),
                    "confidenceScore": candidate.get("confidence_score"),
                }
                for candidate in promoted_candidates
            ]
            created_at = datetime.utcnow()

            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO dd_reports (
                        id,
                        entity_kind,
                        entity_id,
                        status,
                        provider,
                        model,
                        extraction_provider,
                        extraction_model,
                        prompt_version,
                        query,
                        analysis_text,
                        request_context,
                        source_snapshot,
                        extracted_contacts,
                        promoted_contacts,
                        analysis_raw_response,
                        extraction_raw_response,
                        created_at
                    )
                    VALUES (
                        %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                    )
                    """,
                    (
                        report_id,
                        entity_kind,
                        entity_id,
                        report.get("status"),
                        report.get("provider"),
                        report.get("model"),
                        report.get("extraction_provider"),
                        report.get("extraction_model"),
                        report.get("prompt_version"),
                        request.query,
                        report.get("analysis"),
                        Json(context),
                        Json(source_snapshot) if source_snapshot is not None else None,
                        Json(annotated_contacts),
                        Json(promoted_contacts_payload),
                        Json(report.get("analysis_raw_response")) if report.get("analysis_raw_response") is not None else None,
                        Json(report.get("extraction_raw_response")) if report.get("extraction_raw_response") is not None else None,
                        created_at,
                    ),
                )

            conn.commit()
            serialized_report = _serialize_dd_report(
                {
                    "id": report_id,
                    "entity_kind": entity_kind,
                    "entity_id": entity_id,
                    "status": report.get("status"),
                    "provider": report.get("provider"),
                    "model": report.get("model"),
                    "extraction_provider": report.get("extraction_provider"),
                    "extraction_model": report.get("extraction_model"),
                    "prompt_version": report.get("prompt_version"),
                    "analysis_text": report.get("analysis"),
                    "source_snapshot": source_snapshot,
                    "extracted_contacts": annotated_contacts,
                    "promoted_contacts": promoted_contacts_payload,
                    "created_at": created_at,
                }
            )

        return {
            "status": "success",
            "provider": report.get("provider"),
            "analysis": report.get("analysis"),
            "ddReport": serialized_report,
        }
    except Exception as e:
        if conn is not None:
            conn.rollback()
        return Response(str(e), status_code=500)
    finally:
        if conn is not None:
            conn.close()

# --- Deal Execution: LOI Generator ---

class LOIRequest(BaseModel):
    company_name: str
    commodity: str
    target_price: float
    quantity: str
    validity_days: int = 7

@app.post("/api/deals/generate-loi")
def generate_loi(request: LOIRequest):
    """
    Generates a professional Letter of Intent (LOI) for commodity purchase.
    """
    loi_text = f"""
LETTER OF INTENT (LOI) - COMMODITY PURCHASE
-------------------------------------------
REF ID: DEAL-{uuid.uuid4().hex[:8].upper()}
DATE: {datetime.now().strftime('%Y-%m-%d')}

TO: {request.company_name}
RE: SOFT CORPORATE OFFER FOR {request.commodity.upper()}

We, the undersigned, hereby confirm our interest and capability to purchase:
COMMODITY: {request.commodity}
QUANTITY: {request.quantity}
TARGET PRICE: ${request.target_price} USD per KG/Unit
INCOTERMS: FOB / CIF (Subject to Negotiation)

PROCEDURE:
1. Seller issues FCO (Full Corporate Offer).
2. Buyer issues ICPO with full banking coordinates.
3. SPA execution and logistics coordination.

This LOI is valid for {request.validity_days} days.

SIGNATURE:
[Digital Signature Placeholder]
Execution Engine v1.0
"""
    return {"status": "success", "loi": loi_text}

# --- Community Miner Endpoints ---

@app.get("/meeting-points")
def get_meeting_points():
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    try:
        c.execute("SELECT * FROM meeting_points ORDER BY created_at DESC")
        return c.fetchall()
    finally:
        conn.close()

@app.post("/meeting-points")
def create_meeting_point(item: MeetingPointCreate):
    conn = get_db_connection()
    c = conn.cursor()
    new_id = str(uuid.uuid4())
    try:
        c.execute('''
            INSERT INTO meeting_points (id, name, lat, lng, address, status)
            VALUES (%s, %s, %s, %s, %s, %s)
        ''', (new_id, item.name, item.lat, item.lng, item.address, item.status))
        conn.commit()
        return {**item.dict(), "id": new_id}
    except Exception as e:
        conn.rollback()
        return Response(str(e), status_code=500)
    finally:
        conn.close()

@app.get("/miner-listings")
def get_miner_listings(miner_id: Optional[str] = None):
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if miner_id:
            c.execute("SELECT * FROM miner_listings WHERE miner_id = %s ORDER BY created_at DESC", (miner_id,))
        else:
            c.execute("SELECT * FROM miner_listings ORDER BY created_at DESC")
        return c.fetchall()
    finally:
        conn.close()

@app.post("/miner-listings")
def create_miner_listing(item: MinerListingCreate):
    conn = get_db_connection()
    c = conn.cursor()
    new_id = str(uuid.uuid4())
    try:
        c.execute('''
            INSERT INTO miner_listings (id, miner_id, lat, lng, price_per_kg, quantity, shape, product, meeting_point_id, meeting_date)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ''', (new_id, item.miner_id, item.lat, item.lng, item.price_per_kg, item.quantity, item.shape, item.product, item.meeting_point_id, item.meeting_date))
        conn.commit()
        return {**item.dict(), "id": new_id, "status": "PENDING"}
    except Exception as e:
        conn.rollback()
        return Response(str(e), status_code=500)
    finally:
        conn.close()

@app.put("/miner-listings/{listing_id}/verify")
def verify_miner_listing(listing_id: str, item: MinerListingVerify):
    conn = get_db_connection()
    c = conn.cursor()
    try:
        c.execute('''
            UPDATE miner_listings 
            SET status = %s, meeting_outcome = %s, communication_log = %s
            WHERE id = %s
        ''', (item.status, item.meeting_outcome, item.communication_log, listing_id))
        
        # If the status is being updated to PURCHASED, let's auto-transfer it to DoreMarket
        if item.status == "PURCHASED":
            c.execute("SELECT * FROM miner_listings WHERE id = %s", (listing_id,))
            listing = c.fetchone()
            if listing:
                try:
                    payload = {
                        "listing_id": listing[0],
                        "miner_id": listing[1],
                        "lat": listing[2],
                        "lng": listing[3],
                        "price_per_kg": listing[5],
                        "quantity": listing[6],
                        "shape": listing[7],
                        "product": listing[8],
                        "tested_weight": listing[14],
                        "tested_purity": listing[15],
                        "final_offer": listing[16],
                    }
                    import requests
                    requests.post("http://localhost:3000/api/webhooks/mining-map", json=payload, timeout=5)
                except Exception as ex:
                    print(f"Failed to post to DoreMarket Webhook: {ex}")
                
        conn.commit()
        return {"status": "success", "id": listing_id}
    except Exception as e:
        conn.rollback()
        return Response(str(e), status_code=500)
    finally:
        conn.close()

@app.post("/miner-listings/{listing_id}/assay")
def assay_miner_listing(listing_id: str, item: MinerListingAssay):
    conn = get_db_connection()
    c = conn.cursor()
    try:
        c.execute("""
            UPDATE miner_listings 
            SET tested_weight = %s, tested_purity = %s, final_offer = %s, status = 'OFFER' 
            WHERE id = %s
        """, (item.tested_weight, item.tested_purity, item.final_offer, listing_id))
        conn.commit()

        if c.rowcount == 0:
            return Response("Listing not found", status_code=404)

        return {"status": "Assayed and Offer Made", "id": listing_id}
    except Exception as e:
        conn.rollback()
        return Response(str(e), status_code=500)
    finally:
        conn.close()

@app.post("/miner-listings/{listing_id}/accept-offer")
def accept_miner_offer(listing_id: str):
    conn = get_db_connection()
    c = conn.cursor()
    try:
        c.execute("UPDATE miner_listings SET status = 'ACCEPTED' WHERE id = %s AND status = 'OFFER'", (listing_id,))
        if c.rowcount == 0:
             return Response("Listing not found or not in OFFER state", status_code=400)
        conn.commit()
        return {"status": "Offer Accepted", "id": listing_id}
    except Exception as e:
        conn.rollback()
        return Response(str(e), status_code=500)
    finally:
        conn.close()

@app.post("/miner-listings/{listing_id}/photo")
async def upload_listing_photo(listing_id: str, file: UploadFile = File(...)):
    conn = get_db_connection()
    c = conn.cursor()
    
    try:
        c.execute("SELECT id FROM miner_listings WHERE id = %s", (listing_id,))
        if not c.fetchone():
            return Response("Listing not found", status_code=404)

        file_id = str(uuid.uuid4())
        safe_filename = file.filename.replace(" ", "_")
        safe_filename = "".join(x for x in safe_filename if x.isalnum() or x in "._-")
        if not safe_filename: safe_filename = "unnamed_file"
        
        final_path = os.path.join(UPLOAD_DIR, f"{file_id}_{safe_filename}")
        file_url = f"/files/{file_id}_{safe_filename}"
        
        with open(final_path, "wb") as buffer:
            import shutil
            shutil.copyfileobj(file.file, buffer)
                
        c.execute("UPDATE miner_listings SET photo_url = %s WHERE id = %s", (file_url, listing_id))
        conn.commit()
        return {"id": file_id, "url": file_url}
    except Exception as e:
        conn.rollback()
        return {"error": str(e)}
    finally:
        conn.close()

@app.put("/miner-listings/{listing_id}")
def update_miner_listing(listing_id: str, item: MinerListingUpdate):
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    try:
        c.execute("SELECT * FROM miner_listings WHERE id = %s", (listing_id,))
        existing = c.fetchone()
        if not existing:
            return Response("Listing not found", status_code=404)

        updates = []
        values = []
        
        if item.lat is not None:
            updates.append("lat = %s"); values.append(item.lat)
        if item.lng is not None:
             updates.append("lng = %s"); values.append(item.lng)
        if item.price_per_kg is not None:
             updates.append("price_per_kg = %s"); values.append(item.price_per_kg)
        if item.quantity is not None:
             updates.append("quantity = %s"); values.append(item.quantity)
        if item.shape is not None:
             updates.append("shape = %s"); values.append(item.shape)
        if item.product is not None:
             updates.append("product = %s"); values.append(item.product)
        if item.meeting_point_id is not None:
             updates.append("meeting_point_id = %s"); values.append(item.meeting_point_id)
        if item.meeting_date is not None:
             updates.append("meeting_date = %s"); values.append(item.meeting_date)

        if not updates:
            return {"status": "no changes"}
            
        values.append(listing_id)
        sql = f"UPDATE miner_listings SET {', '.join(updates)} WHERE id = %s"
        c.execute(sql, tuple(values))
        conn.commit()
        return {"status": "updated", "id": listing_id}
    except Exception as e:
        conn.rollback()
        return Response(str(e), status_code=500)
    finally:
        conn.close()

@app.delete("/miner-listings/{listing_id}")
def delete_miner_listing(listing_id: str):
    conn = get_db_connection()
    c = conn.cursor()
    try:
        c.execute("DELETE FROM miner_listings WHERE id = %s", (listing_id,))
        if c.rowcount == 0:
             return Response("Listing not found", status_code=404)
        conn.commit()
        return {"status": "deleted", "id": listing_id}
    except Exception as e:
        conn.rollback()
        return Response(str(e), status_code=500)
    finally:
        conn.close()

# --- Live Market Prices (Entrepreneur Desk) ---
# Using requests (already available) against a public free API — no extra libraries needed.
import requests as _requests

FALLBACK_PRICES = [
    {"symbol": "XAU/USD", "price": "—", "change": "—", "up": None},
    {"symbol": "XAG/USD", "price": "—", "change": "—", "up": None},
    {"symbol": "BTC/USD", "price": "103,200.00", "change": "+1.85%", "up": True},
    {"symbol": "BRENT", "price": "64.20", "change": "+0.72%", "up": True},
]

_YAHOO_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"


def _yahoo_futures_spot(yahoo_symbol: str):
    """Last price + prior close for a Yahoo Finance symbol (e.g. CL=F, BZ=F)."""
    try:
        r = _requests.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{yahoo_symbol}",
            params={"interval": "1d", "range": "2d"},
            headers={"User-Agent": _YAHOO_UA, "Accept": "application/json"},
            timeout=10,
        )
        if r.status_code != 200:
            return None
        chart = r.json().get("chart", {})
        res = chart.get("result") or []
        if not res:
            return None
        meta = res[0].get("meta") or {}
        price = meta.get("regularMarketPrice")
        if price is None:
            price = meta.get("previousClose")
        prev = meta.get("chartPreviousClose") or meta.get("previousClose")
        if price is None:
            return None
        price = float(price)
        prev_f = float(prev) if prev is not None else None
        chg_pct = None
        if prev_f and prev_f > 0:
            chg_pct = (price - prev_f) / prev_f * 100.0
        return {"price": price, "chg_pct": chg_pct}
    except Exception as ex:
        print(f"[yahoo] {yahoo_symbol}: {ex}")
        return None


def _normalize_comex_usd_per_troy_oz(price: float, *, metal: str) -> float:
    """
    Yahoo GC=F / SI=F are COMEX continuous futures quoted in USD per troy ounce.
    If an upstream ever returns cents-per-oz scale, pull it back to dollars.
    """
    p = float(price)
    if metal == "gold" and p > 50_000:
        p = p / 100.0
    if metal == "silver" and p > 500:
        p = p / 100.0
    return p


def _ticker_metal_row(label: str, category: str, yahoo_sym: str, metal: str, price_fmt):
    """Ticker row for COMEX gold/silver futures (USD/troy oz), indicative / may be delayed."""
    q = _yahoo_futures_spot(yahoo_sym)
    if not q:
        return None
    adj = _normalize_comex_usd_per_troy_oz(q["price"], metal=metal)
    up = True if q["chg_pct"] is None else q["chg_pct"] >= 0
    chg = "LIVE" if q["chg_pct"] is None else f"{q['chg_pct']:+.2f}%"
    return {
        "symbol": label,
        "price": price_fmt(adj),
        "category": category,
        "up": up,
        "change": chg,
    }


def _ticker_energy_row(label: str, category: str, yahoo_sym: str, price_fmt):
    """price_fmt: callable(float) -> str for display."""
    q = _yahoo_futures_spot(yahoo_sym)
    if not q:
        return None
    up = True if q["chg_pct"] is None else q["chg_pct"] >= 0
    chg = "LIVE" if q["chg_pct"] is None else f"{q['chg_pct']:+.2f}%"
    return {
        "symbol": label,
        "price": price_fmt(q["price"]),
        "category": category,
        "up": up,
        "change": chg,
    }


@app.get("/api/market-ticker")
def get_market_ticker():
    """
    Rows for the web app ticker + dashboard: metals, crypto, and CME/NYMEX-style
    benchmarks via Yahoo. No API key.

    Gold/silver: COMEX continuous futures GC=F / SI=F in USD per troy ounce (standard
    spot-style screen convention). Indicative only; Yahoo can be exchange-delayed vs
    physical spot. If Yahoo blocks a symbol, the row shows an em dash (no demo numbers).
    """
    rows: list = []

    gold_row = _ticker_metal_row("GOLD/oz", "Metal", "GC=F", "gold", lambda p: f"${p:,.2f}")
    if gold_row:
        rows.append(gold_row)
    else:
        rows.append({"symbol": "GOLD/oz", "price": "$—", "category": "Metal", "up": None, "change": "—"})
    silver_row = _ticker_metal_row("SILVER/oz", "Metal", "SI=F", "silver", lambda p: f"${p:,.2f}")
    if silver_row:
        rows.append(silver_row)
    else:
        rows.append({"symbol": "SILVER/oz", "price": "$—", "category": "Metal", "up": None, "change": "—"})

    try:
        btc_res = _requests.get(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true",
            timeout=6,
        )
        if btc_res.status_code == 200:
            btc_data = btc_res.json().get("bitcoin", {})
            btc_price = btc_data.get("usd", 0)
            btc_change = btc_data.get("usd_24h_change", 0) or 0
            rows.append({
                "symbol": "BTC/USD",
                "price": f"${float(btc_price):,.2f}",
                "category": "Crypto",
                "up": btc_change >= 0,
                "change": f"{'+' if btc_change >= 0 else ''}{btc_change:.2f}%",
            })
    except Exception:
        pass

    # ICE / NYMEX continuous futures on Yahoo
    for spec in (
        ("BRENT", "Energy", "BZ=F", lambda p: f"${p:.2f}/bbl"),
        ("WTI CRUDE", "Energy", "CL=F", lambda p: f"${p:.2f}/bbl"),
        ("HEATING OIL", "Energy", "HO=F", lambda p: f"${p:.3f}/gal"),
        ("COPPER", "Industrial", "HG=F", lambda p: f"${p:.3f}/lb"),
        ("SUGAR #11", "Softs", "SB=F", lambda p: f"{p * 100:.2f}¢/lb"),
        ("COFFEE", "Softs", "KC=F", lambda p: f"{p * 100:.2f}¢/lb"),
    ):
        label, cat, sym, fmt = spec
        rrow = _ticker_energy_row(label, cat, sym, fmt)
        if rrow:
            rows.append(rrow)

    return rows


@app.get("/market-prices")
def get_market_prices():
    """
    Commodity benchmarks: gold/silver as COMEX GC=F / SI=F (USD/troy oz, indicative / may be delayed),
    BTC via CoinGecko, oil via Yahoo. Never returns 500.
    """
    try:
        results = []

        gq = _yahoo_futures_spot("GC=F")
        if gq:
            gp = _normalize_comex_usd_per_troy_oz(gq["price"], metal="gold")
            up = True if gq["chg_pct"] is None else gq["chg_pct"] >= 0
            chg = "LIVE" if gq["chg_pct"] is None else f"{'+' if gq['chg_pct'] >= 0 else ''}{gq['chg_pct']:.2f}%"
            results.append({"symbol": "XAU/USD", "price": f"{gp:,.2f}", "change": chg, "up": up})
        else:
            results.append({"symbol": "XAU/USD", "price": "—", "change": "—", "up": None})

        sq = _yahoo_futures_spot("SI=F")
        if sq:
            sp = _normalize_comex_usd_per_troy_oz(sq["price"], metal="silver")
            up = True if sq["chg_pct"] is None else sq["chg_pct"] >= 0
            chg = "LIVE" if sq["chg_pct"] is None else f"{'+' if sq['chg_pct'] >= 0 else ''}{sq['chg_pct']:.2f}%"
            results.append({"symbol": "XAG/USD", "price": f"{sp:,.2f}", "change": chg, "up": up})
        else:
            results.append({"symbol": "XAG/USD", "price": "—", "change": "—", "up": None})

        # BTC via CoinGecko (free, no auth)
        btc_res = _requests.get(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true",
            timeout=5
        )
        if btc_res.status_code == 200:
            btc_data = btc_res.json().get("bitcoin", {})
            btc_price = btc_data.get("usd", 103200)
            btc_change = btc_data.get("usd_24h_change", 0)
            results.append({
                "symbol": "BTC/USD",
                "price": f"{btc_price:,.2f}",
                "change": f"{'+' if btc_change >= 0 else ''}{btc_change:.2f}%",
                "up": btc_change >= 0
            })
        else:
            results.append(FALLBACK_PRICES[2])

        # Brent & WTI — Yahoo
        bz = _yahoo_futures_spot("BZ=F")
        cl = _yahoo_futures_spot("CL=F")
        if bz:
            up = True if bz["chg_pct"] is None else bz["chg_pct"] >= 0
            chg = "LIVE" if bz["chg_pct"] is None else f"{'+' if bz['chg_pct'] >= 0 else ''}{bz['chg_pct']:.2f}%"
            results.append({"symbol": "BRENT", "price": f"{bz['price']:.2f}", "change": chg, "up": up})
        else:
            results.append(FALLBACK_PRICES[3])
        if cl:
            up = True if cl["chg_pct"] is None else cl["chg_pct"] >= 0
            chg = "LIVE" if cl["chg_pct"] is None else f"{'+' if cl['chg_pct'] >= 0 else ''}{cl['chg_pct']:.2f}%"
            results.append({"symbol": "WTI", "price": f"{cl['price']:.2f}", "change": chg, "up": up})

        return results if results else FALLBACK_PRICES

    except Exception as e:
        print(f"[market-prices] fetch error: {e}")
        return FALLBACK_PRICES


# ======================================================================
# Trade & Company Intelligence Endpoint
# ======================================================================
#
# Data sources:
#   1. UN Comtrade (free tier, 500 req/day) — country-level commodity
#      trade flows (exports/imports, USD value, weight) by HS code.
#      Requires env var: COMTRADE_API_KEY (register at comtradeapi.un.org)
#
#   2. World Bank Open Data (free, no key) — GDP, FDI inflows,
#      GDP per capita, mining share of GDP.
#
#   3. Pre-built deep links — OpenCorporates, EITI, Comtrade+, Google
#      for manual human-in-the-loop verification.
#
# Known limitations (returned in response):
#   - Trade data is COUNTRY-level; company-level customs data is NOT free.
#   - Comtrade lags 12-24 months; World Bank lags ~12 months.
#   - Coverage depends on member state reporting cadence.
#
# Env vars required/optional:
#   COMTRADE_API_KEY  — UN Comtrade subscription key (optional; endpoint
#                       degrades gracefully to deep-links only if absent)

_COMMODITY_HS: dict[str, str] = {
    "gold": "7108", "silver": "7106",
    "diamond": "7102", "diamonds": "7102",
    "platinum": "7110", "palladium": "7110",
    "copper": "7403",
    "iron ore": "2601", "iron": "2601",
    "coal": "2701",
    "bauxite": "2606",
    "aluminium": "7601", "aluminum": "7601",
    "manganese": "2602",
    "chromite": "2610", "chrome": "2610",
    "cobalt": "2605",
    "lithium": "2825",
    "nickel": "7502",
    "zinc": "7901",
    "lead": "7801",
    "tin": "8001",
    "tungsten": "2611",
    "titanium": "2614",
    "tantalum": "2615",
    "coltan": "2615",
    "uranium": "2612",
}

# Country display name (lower) → {iso2, m49}
# m49 = UN Comtrade reporter code; iso2 = World Bank country code
_COUNTRY_CODES: dict[str, dict] = {
    "ghana":                        {"iso2": "GH", "m49": "288"},
    "south africa":                 {"iso2": "ZA", "m49": "710"},
    "nigeria":                      {"iso2": "NG", "m49": "566"},
    "kenya":                        {"iso2": "KE", "m49": "404"},
    "tanzania":                     {"iso2": "TZ", "m49": "834"},
    "ethiopia":                     {"iso2": "ET", "m49": "231"},
    "mozambique":                   {"iso2": "MZ", "m49": "508"},
    "zambia":                       {"iso2": "ZM", "m49": "894"},
    "zimbabwe":                     {"iso2": "ZW", "m49": "716"},
    "botswana":                     {"iso2": "BW", "m49": "072"},
    "namibia":                      {"iso2": "NA", "m49": "516"},
    "dr congo":                     {"iso2": "CD", "m49": "180"},
    "democratic republic of the congo": {"iso2": "CD", "m49": "180"},
    "congo":                        {"iso2": "CG", "m49": "178"},
    "mali":                         {"iso2": "ML", "m49": "466"},
    "burkina faso":                 {"iso2": "BF", "m49": "854"},
    "senegal":                      {"iso2": "SN", "m49": "686"},
    "guinea":                       {"iso2": "GN", "m49": "324"},
    "sierra leone":                 {"iso2": "SL", "m49": "694"},
    "liberia":                      {"iso2": "LR", "m49": "430"},
    "ivory coast":                  {"iso2": "CI", "m49": "384"},
    "côte d'ivoire":                {"iso2": "CI", "m49": "384"},
    "cameroon":                     {"iso2": "CM", "m49": "120"},
    "angola":                       {"iso2": "AO", "m49": "024"},
    "sudan":                        {"iso2": "SD", "m49": "729"},
    "egypt":                        {"iso2": "EG", "m49": "818"},
    "morocco":                      {"iso2": "MA", "m49": "504"},
    "mauritania":                   {"iso2": "MR", "m49": "478"},
    "niger":                        {"iso2": "NE", "m49": "562"},
    "chad":                         {"iso2": "TD", "m49": "148"},
    "central african republic":     {"iso2": "CF", "m49": "140"},
    "gabon":                        {"iso2": "GA", "m49": "266"},
    "rwanda":                       {"iso2": "RW", "m49": "646"},
    "uganda":                       {"iso2": "UG", "m49": "800"},
    "madagascar":                   {"iso2": "MG", "m49": "450"},
    "malawi":                       {"iso2": "MW", "m49": "454"},
    "eritrea":                      {"iso2": "ER", "m49": "232"},
    "somalia":                      {"iso2": "SO", "m49": "706"},
    "djibouti":                     {"iso2": "DJ", "m49": "262"},
    "togo":                         {"iso2": "TG", "m49": "768"},
    "benin":                        {"iso2": "BJ", "m49": "204"},
    "guinea-bissau":                {"iso2": "GW", "m49": "624"},
    "gambia":                       {"iso2": "GM", "m49": "270"},
    "equatorial guinea":            {"iso2": "GQ", "m49": "226"},
    "comoros":                      {"iso2": "KM", "m49": "174"},
    "burundi":                      {"iso2": "BI", "m49": "108"},
    "lesotho":                      {"iso2": "LS", "m49": "426"},
    "eswatini":                     {"iso2": "SZ", "m49": "748"},
    "swaziland":                    {"iso2": "SZ", "m49": "748"},
}


def _resolve_codes(country: str) -> dict:
    """Partial-match country name to ISO codes."""
    key = country.lower().strip()
    if key in _COUNTRY_CODES:
        return _COUNTRY_CODES[key]
    for k, v in _COUNTRY_CODES.items():
        if k in key or key in k:
            return v
    return {}


def _resolve_hs(commodity: str) -> Optional[str]:
    """Map commodity string to HS-4 code."""
    key = commodity.lower().strip()
    if key in _COMMODITY_HS:
        return _COMMODITY_HS[key]
    for k, v in _COMMODITY_HS.items():
        if k in key or key in k:
            return v
    return None


def _fetch_comtrade(m49: str, hs_code: str, year: int = 2023) -> dict:
    """Fetch Comtrade trade flows. Returns {} if key absent or error."""
    api_key = os.getenv("COMTRADE_API_KEY", "")
    if not api_key:
        return {}
    try:
        url = (
            "https://comtradeapi.un.org/data/v1/get/C/A/HS"
            f"?reporterCode={m49}&cmdCode={hs_code}"
            f"&period={year}&flowCode=X,M"
            f"&subscription-key={api_key}&limit=10"
        )
        r = _requests.get(url, timeout=8)
        if r.status_code == 200:
            rows = r.json().get("data", [])
            flows = []
            for row in rows:
                flows.append({
                    "flow": "Export" if row.get("flowCode") == "X" else "Import",
                    "trade_value_usd": row.get("primaryValue"),
                    "net_weight_kg": row.get("netWgt"),
                    "qty": row.get("qty"),
                    "qty_unit": row.get("qtyUnitAbbr"),
                    "partner": row.get("partnerDesc"),
                    "year": row.get("period"),
                })
            return {"source": "UN Comtrade", "year": year, "hs_code": hs_code, "flows": flows}
        # Try one year back on 404/empty
        if r.status_code in (404, 200) and year > 2020:
            return _fetch_comtrade(m49, hs_code, year - 1)
        return {}
    except Exception as e:
        print(f"[comtrade] error: {e}")
        return {}


def _fetch_world_bank(iso2: str) -> dict:
    """Fetch World Bank macro indicators. Free, no key."""
    result: dict = {"source": "World Bank Open Data", "indicators": {}}
    indicators = {
        "NY.GDP.MKTP.CD":       "gdp_usd",
        "NY.GDP.PCAP.CD":       "gdp_per_capita_usd",
        "BX.KLT.DINV.CD.WD":   "fdi_inflows_usd",
        "NY.GDP.MINR.ZS":       "mining_share_of_gdp_pct",
    }
    for wb_code, label in indicators.items():
        try:
            url = (
                f"https://api.worldbank.org/v2/country/{iso2}"
                f"/indicator/{wb_code}?format=json&mrv=3"
            )
            r = _requests.get(url, timeout=6)
            if r.status_code == 200:
                body = r.json()
                if len(body) > 1 and body[1]:
                    for entry in body[1]:
                        if entry.get("value") is not None:
                            result["indicators"][label] = {
                                "value": entry["value"],
                                "year": entry["date"],
                            }
                            break
        except Exception as e:
            print(f"[worldbank] {wb_code}: {e}")
    return result


@app.get("/api/company-intel")
def get_company_intel(company: str = "", country: str = "", commodity: str = ""):
    """
    Aggregate open-data trade & economic context for a mining license dossier.
    Returns UN Comtrade country-level trade flows, World Bank macro data,
    and deep links for manual company verification.
    Data provenance and known limitations are documented in the response.
    """
    hs_code = _resolve_hs(commodity)
    codes = _resolve_codes(country)

    trade_data: dict = {}
    if hs_code and codes.get("m49"):
        trade_data = _fetch_comtrade(codes["m49"], hs_code)

    econ_data: dict = {}
    if codes.get("iso2"):
        econ_data = _fetch_world_bank(codes["iso2"])

    # Pre-built deep links — no API calls, always available
    company_q = _requests.utils.quote(company)
    commodity_q = _requests.utils.quote(commodity)
    country_q = _requests.utils.quote(country)
    deep_links = [
        {
            "label": "OpenCorporates Search",
            "url": f"https://opencorporates.com/companies?q={company_q}",
            "description": f"Search for '{company}' across 200+ registries",
            "icon": "building",
        },
        {
            "label": "EITI Extractive Data",
            "url": "https://eiti.org/countries",
            "description": f"{country} extractive sector transparency data",
            "icon": "shield",
        },
        {
            "label": f"Comtrade+ Interactive ({commodity})",
            "url": (
                f"https://comtradeplus.un.org/TradeFlow"
                f"?Frequency=A&Flows=X%2CM"
                f"&CommodityCodes={hs_code or ''}"
                f"&Partners=0&Reporters=0&period=2023"
                f"&AggregateBy=none&BreakdownMode=plus"
            ),
            "description": f"Explore HS {hs_code or 'N/A'} ({commodity}) trade flows",
            "icon": "chart",
        },
        {
            "label": "Company Export History (Web)",
            "url": f"https://www.google.com/search?q={company_q}+{commodity_q}+export+customs",
            "description": "Verify company trade activity via open web sources",
            "icon": "search",
        },
        {
            "label": "African Mining Registry Links",
            "url": f"https://www.google.com/search?q={country_q}+mining+license+registry+{commodity_q}",
            "description": f"Search {country} mining authority records",
            "icon": "map",
        },
    ]

    has_comtrade_key = bool(os.getenv("COMTRADE_API_KEY", ""))
    return {
        "company": company,
        "country": country,
        "commodity": commodity,
        "hs_code": hs_code,
        "country_codes": codes,
        "trade_flows": trade_data,
        "economy": econ_data,
        "deep_links": deep_links,
        "comtrade_available": has_comtrade_key,
        "data_as_of": "2023 (most recent Comtrade/World Bank release)",
        "limitations": [
            "Trade data is country-level, not company-specific — company-level customs data requires paid government sources.",
            "UN Comtrade data typically lags 12–24 months from the current date.",
            "World Bank indicators lag approximately 12 months.",
            "Verify all figures with the local customs authority and mining registry before deal execution.",
        ],
    }


@app.get("/api/maritime/vessels")
def get_maritime_vessels(
    max_vessels: int = 60,
    capture_window_seconds: int = 10,
    scope: str = "oil_tankers",
    south: Optional[float] = None,
    west: Optional[float] = None,
    north: Optional[float] = None,
    east: Optional[float] = None,
):
    """Optional live AIS maritime layer for oil and gas mode."""
    try:
        try:
            from backend.services.maritime_intel import get_maritime_vessel_feed
        except ImportError:
            from services.maritime_intel import get_maritime_vessel_feed
        bbox = None
        if all(value is not None for value in (south, west, north, east)):
            bbox = (float(south), float(west), float(north), float(east))
        return get_maritime_vessel_feed(
            max_vessels=max_vessels,
            capture_window_seconds=capture_window_seconds,
            vessel_scope=scope,
            bbox=bbox,
        )
    except Exception as exc:
        return {
            "vessels": [],
            "source": "maritime_intel_error",
            "data_as_of": datetime.utcnow().isoformat(),
            "live_positions_enabled": False,
            "limitations": [f"Maritime vessel feed failed: {exc}"],
            "scope": "oil_tankers" if scope != "all_vessels" else "all_vessels",
            "capture_window_seconds": capture_window_seconds,
            "max_vessels": max_vessels,
            "geography_mode": "viewport_bbox" if all(value is not None for value in (south, west, north, east)) else "default_regions",
            "geography_note": None,
            "requested_bbox": [south, west, north, east] if all(value is not None for value in (south, west, north, east)) else None,
            "effective_bbox_count": 0,
            "region_labels": [],
        }


@app.get("/api/maritime/context")
def get_maritime_context(
    company: str = "",
    country: str = "",
    commodity: str = "",
    lat: Optional[float] = None,
    lng: Optional[float] = None,
    vessel_name: str = "",
    mmsi: str = "",
    imo: str = "",
    destination: str = "",
):
    """
    Open/free maritime context for oil & gas screening.

    This endpoint is explicit about scope: it returns vessel/company/port/news
    evidence and counterparty proxies, not true bill-of-lading coverage.
    """
    try:
        try:
            from backend.services.maritime_intel import get_maritime_context as build_maritime_context
        except ImportError:
            from services.maritime_intel import get_maritime_context as build_maritime_context
        codes = _resolve_codes(country) if country else {}
        return build_maritime_context(
            company=company,
            country=country,
            country_iso2=codes.get("iso2", ""),
            commodity=commodity,
            lat=lat,
            lng=lng,
            vessel_name=vessel_name,
            mmsi=mmsi,
            imo=imo,
            destination=destination,
        )
    except Exception as exc:
        return {
            "source_labels": [],
            "data_as_of": datetime.utcnow().isoformat(),
            "company_links": [],
            "nearest_ports": [],
            "evidence": [],
            "identity": None,
            "relationships": [],
            "counterparty_proxies": [],
            "bol_coverage_note": (
                "Bill-of-lading buyer/seller coverage is not reliably available from free/open sources."
            ),
            "limitations": [f"Maritime context failed: {exc}"],
        }


@app.get("/api/storage/terminals")
def get_storage_terminals(force_refresh: bool = False):
    """Live open/global storage terminal feed for the oil-and-gas view."""
    try:
        try:
            from backend.services.storage_terminals import get_storage_terminals as build_storage_terminals
        except ImportError:
            from services.storage_terminals import get_storage_terminals as build_storage_terminals
        return build_storage_terminals(force_refresh=force_refresh)
    except Exception as exc:
        return {
            "entities": [],
            "source_labels": ["OpenStreetMap", "Overpass", "UN/LOCODE"],
            "data_as_of": datetime.utcnow().isoformat(),
            "coverage_note": "Storage-terminal feed failed before any live global entities could be returned.",
            "limitations": [f"Storage terminal feed failed: {exc}"],
            "stats": {
                "total": 0,
                "countries": 0,
                "with_operator": 0,
                "with_capacity": 0,
                "with_nearby_port": 0,
                "high_confidence": 0,
                "by_subtype": {},
                "top_countries": [],
            },
        }


@app.get("/api/storage/terminals/{terminal_id:path}")
def get_storage_terminal_detail(terminal_id: str):
    try:
        try:
            from backend.services.storage_terminals import get_storage_terminal_details
        except ImportError:
            from services.storage_terminals import get_storage_terminal_details

        result = get_storage_terminal_details(terminal_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Storage terminal not found")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Storage terminal detail failed: {exc}")


@app.get("/api/logistics/ports")
def get_port_logistics_entities(force_refresh: bool = False):
    """Global open/free port and logistics-node feed for the ports view."""
    try:
        try:
            from backend.services.port_logistics import get_port_logistics_entities as build_port_logistics_entities
        except ImportError:
            from services.port_logistics import get_port_logistics_entities as build_port_logistics_entities
        return build_port_logistics_entities(force_refresh=force_refresh)
    except Exception as exc:
        return {
            "entities": [],
            "source_labels": ["UN/LOCODE", "OpenStreetMap", "GDELT DOC 2.0"],
            "data_as_of": datetime.utcnow().isoformat(),
            "coverage_note": "Port/logistics feed failed before any live global entities could be returned.",
            "limitations": [f"Port/logistics feed failed: {exc}"],
            "stats": {
                "total": 0,
                "countries": 0,
                "ports": 0,
                "with_locode": 0,
                "with_nearby_port": 0,
                "high_confidence": 0,
                "by_subtype": {},
                "top_countries": [],
                "map_render_limit": 3000,
            },
        }


@app.get("/api/logistics/ports/{entity_id:path}")
def get_port_logistics_detail(entity_id: str):
    try:
        try:
            from backend.services.port_logistics import get_port_logistics_details
        except ImportError:
            from services.port_logistics import get_port_logistics_details

        result = get_port_logistics_details(entity_id)
        if result is None:
            raise HTTPException(status_code=404, detail="Port/logistics entity not found")
        return result
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Port/logistics detail failed: {exc}")


# ======================================================================
# Oil & Petroleum Trade Flows
# ======================================================================
#
# Data provenance
# ---------------
#   Primary live source : UN Comtrade API v1 (https://comtradeapi.un.org)
#       Requires env var  COMTRADE_API_KEY (free registration at
#       https://comtradeplus.un.org/ — 500 req/day on free tier).
#   Static seed fallback: Curated 2022 export figures (HS 2709/2710/2711)
#       derived from UN Comtrade aggregate tables (2024-Q4) and
#       BP Statistical Review of World Energy 2023.
#
# HS codes covered
# ----------------
#   2709  Petroleum oils, crude
#   2710  Petroleum oils, not crude (gasoline, diesel, fuel oil, lubricants)
#   2711  Petroleum gases (LNG, LPG, natural gas, propane, butane)
#
#   NOTE: HS 2517 ("Pebbles, gravel, broken or crushed stone") is NOT a
#   petroleum code. The correct petroleum HS chapter is 27 (2709–2711).
#
# Known limitations
# -----------------
#   - All data is country-level, not company-specific.
#   - Comtrade data typically lags 12–24 months.
#   - Russia 2022 figures may be under-reported due to sanctions data gaps.

_OIL_HS_META: dict[str, str] = {
    "2709": "Petroleum oils, crude",
    "2710": "Petroleum oils, not crude (refined products incl. gasoline, diesel, fuel oil)",
    "2711": "Petroleum gases (LNG, LPG, natural gas, propane, butane)",
}

_OIL_LIMITATIONS: list[str] = [
    "All data is country-level; company-level customs records are not available via free APIs.",
    "UN Comtrade data typically lags 12–24 months from the current date.",
    "Static seed covers 2022 only; use POST /api/admin/oil/ingest to fetch other years.",
    "Russia 2022 figures may be under-reported due to sanctions-related data gaps.",
    "HS 2517 (pebbles/gravel) is NOT a petroleum code — ignored per Comtrade verification.",
]


@app.get("/api/oil/flows")
def get_oil_flows(
    reporter: Optional[str] = None,
    hs: Optional[str] = None,
    year: Optional[int] = None,
    flow: Optional[str] = None,
    limit: int = 200,
):
    """
    Query petroleum trade flows stored in oil_trade_flows.

    Parameters
    ----------
    reporter : country name substring (case-insensitive), e.g. "saudi"
    hs       : HS code, e.g. "2709" | "2710" | "2711"
    year     : e.g. 2022
    flow     : "X" (exports) | "M" (imports)
    limit    : max rows returned (default 200)

    Returns
    -------
    JSON with `data` array + provenance metadata.
    """
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    try:
        filters = []
        params: list = []

        if reporter:
            filters.append("LOWER(reporter) LIKE %s")
            params.append(f"%{reporter.lower()}%")
        if hs:
            filters.append("hs_code = %s")
            params.append(hs)
        if year:
            filters.append("year = %s")
            params.append(year)
        if flow:
            filters.append("flow_type = %s")
            params.append(flow.upper())

        where = ("WHERE " + " AND ".join(filters)) if filters else ""
        params.append(limit)

        c.execute(
            f"""SELECT id, reporter, reporter_iso2, partner, hs_code, hs_description,
                       flow_type, year, trade_value_usd, net_weight_kg, data_source, ingested_at
                FROM oil_trade_flows
                {where}
                ORDER BY year DESC, trade_value_usd DESC NULLS LAST
                LIMIT %s""",
            params,
        )
        rows = c.fetchall()

        return {
            "data": rows,
            "count": len(rows),
            "hs_codes_covered": _OIL_HS_META,
            "provenance": (
                "Seed: UN Comtrade aggregate tables (comtradeplus.un.org, 2024-Q4), "
                "cross-checked with BP Statistical Review 2023. "
                "Live rows sourced via UN Comtrade API v1."
            ),
            "limitations": _OIL_LIMITATIONS,
        }
    except Exception as exc:
        return {"error": str(exc), "data": []}
    finally:
        conn.close()


@app.get("/api/oil/summary")
def get_oil_summary(year: int = 2022):
    """
    Ranked exporters + commodity breakdown for a given year.

    Returns
    -------
    {
      "year": 2022,
      "top_exporters_by_value": [...],     # top 15 across all HS codes
      "breakdown_by_hs": {
        "2709": [...],                     # top exporters per HS code
        "2710": [...],
        "2711": [...],
      },
      "provenance": ...,
      "limitations": [...]
    }
    """
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    try:
        c.execute(
            """SELECT reporter, reporter_iso2,
                      SUM(trade_value_usd)  AS total_value_usd,
                      SUM(net_weight_kg)    AS total_weight_kg,
                      COUNT(DISTINCT hs_code) AS hs_codes_reported
               FROM oil_trade_flows
               WHERE flow_type = 'X' AND year = %s
               GROUP BY reporter, reporter_iso2
               ORDER BY total_value_usd DESC NULLS LAST
               LIMIT 20""",
            (year,),
        )
        top_exporters = c.fetchall()

        breakdown: dict = {}
        for hs_code, hs_desc in _OIL_HS_META.items():
            c.execute(
                """SELECT reporter, reporter_iso2,
                          trade_value_usd, net_weight_kg, data_source
                   FROM oil_trade_flows
                   WHERE flow_type = 'X' AND year = %s AND hs_code = %s
                   ORDER BY trade_value_usd DESC NULLS LAST
                   LIMIT 15""",
                (year, hs_code),
            )
            breakdown[hs_code] = {
                "description": hs_desc,
                "exporters": c.fetchall(),
            }

        return {
            "year": year,
            "top_exporters_by_value": top_exporters,
            "breakdown_by_hs": breakdown,
            "provenance": (
                "Seed: UN Comtrade aggregate tables (comtradeplus.un.org, 2024-Q4), "
                "cross-checked with BP Statistical Review 2023. "
                "Live rows sourced via UN Comtrade API v1."
            ),
            "hs_scope": _OIL_HS_META,
            "limitations": _OIL_LIMITATIONS,
        }
    except Exception as exc:
        return {"error": str(exc)}
    finally:
        conn.close()


class OilIngestRequest(BaseModel):
    year: int = 2022
    seed_only: bool = False


class OpenDataSyncRequest(BaseModel):
    source_ids: Optional[list[str]] = None
    include_bundled_fallback: bool = False


@app.post("/api/admin/oil/ingest")
def admin_oil_ingest(request: OilIngestRequest):
    """
    Admin-triggered route to populate oil_trade_flows.

    Behaviour
    ---------
    1. Always writes/refreshes the static seed rows (2022, HS 2709/2710/2711,
       top exporters — no API key required).
    2. If COMTRADE_API_KEY is set and seed_only=False, also fetches live
       annual data from UN Comtrade for the requested year.

    The upsert is idempotent — safe to call multiple times.
    """
    try:
        # Import here to avoid circular import issues if run standalone
        from ingest_oil_trades import ingest
        result = ingest(year=request.year, seed_only=request.seed_only)
        return {"status": "success", **result}
    except ImportError:
        # Fallback: run ingestion inline using the seed data embedded here
        import sys, os
        sys.path.insert(0, os.path.dirname(__file__))
        try:
            from ingest_oil_trades import ingest
            result = ingest(year=request.year, seed_only=request.seed_only)
            return {"status": "success", **result}
        except Exception as exc:
            return {"status": "error", "message": str(exc)}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


@app.post("/api/admin/open-data/sync")
def admin_open_data_sync(request: OpenDataSyncRequest, x_admin_token: Optional[str] = Header(None)):
    forbidden = _check_admin_token(x_admin_token)
    if forbidden is not None:
        return forbidden

    try:
        try:
            from backend.services.ingest.open_data_sync import sync_open_data_sources, seed_bundled_json_fallback
        except ImportError:
            from services.ingest.open_data_sync import sync_open_data_sources, seed_bundled_json_fallback

        summary = sync_open_data_sources(source_ids=request.source_ids)
        if request.include_bundled_fallback and not summary.get("records_written"):
            conn = get_db_connection()
            try:
                summary["bundled_fallback_inserted"] = seed_bundled_json_fallback(conn)
            finally:
                conn.close()
        return {"status": "success", **summary}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


@app.get("/api/open-data/coverage/africa")
def get_africa_open_data_coverage():
    try:
        try:
            from backend.services.ingest.open_data_sync import get_africa_coverage
        except ImportError:
            from services.ingest.open_data_sync import get_africa_coverage

        return get_africa_coverage()
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


@app.get("/api/open-data/coverage/world")
def get_world_open_data_coverage():
    try:
        try:
            from backend.services.ingest.open_data_sync import get_world_coverage
        except ImportError:
            from services.ingest.open_data_sync import get_world_coverage

        return get_world_coverage()
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


@app.post("/api/admin/import/extracted-csv")
async def admin_import_extracted_csv(
    file: UploadFile = File(...),
    countries: Optional[str] = None,
    source_name: Optional[str] = None,
    sector: str = "mining",
    x_admin_token: Optional[str] = Header(None),
):
    forbidden = _check_admin_token(x_admin_token)
    if forbidden is not None:
        return forbidden

    try:
        try:
            from backend.services.ingest.csv_fallback_import import import_csv_text
        except ImportError:
            from services.ingest.csv_fallback_import import import_csv_text

        content = await file.read()
        text = content.decode("utf-8")
        allowed_countries = [part.strip() for part in (countries or "").split(",") if part.strip()]
        result = import_csv_text(
            text,
            filename=file.filename or "uploaded.csv",
            countries=allowed_countries or None,
            source_name=source_name or None,
            sector=sector,
        )
        return {"status": "success", **result}
    except UnicodeDecodeError:
        return {"status": "error", "message": "CSV must be UTF-8 encoded."}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


# ======================================================================
# License Geocoding Backfill  /api/admin/geocode-licenses
# ======================================================================
#
# Many license rows came in without coordinates (~3000 of ~4000) or share a
# regional centroid because the CSV importer used a static lookup table. This
# endpoint backfills missing/low-quality coords from the existing free-form
# ``region`` + ``country`` text fields using a polite Nominatim query path
# (or Mapbox if MAPBOX_GEOCODING_TOKEN is set).
#
# Safety properties
# -----------------
#   * **Reversible.** Every overwrite snapshots the prior lat/lng into
#     ``original_lat`` / ``original_lng`` (only if they're not already set, so
#     re-runs don't lose the *first* known good value). The companion
#     ``/revert`` route restores them.
#   * **Never overwrites surveyed coords.** Rows tagged ``geo_source='user'``
#     are skipped unless the caller explicitly passes
#     ``allow_overwrite_user=True``.
#   * **Dry-run by default.** Returns a sample of the first 10 changes so an
#     operator can sanity-check before running with ``dry_run=False``.
#   * **Polite to Nominatim.** Hard rate-limit (1.1 s between hits by
#     default), persistent cache table ``geo_cache`` so re-runs don't re-hit.
#
# Auth model
# ----------
# Matches the existing project pattern: optional ``X-Admin-Token`` header is
# checked against ``ADMIN_TOKEN`` env var when set; in dev (env unset) the
# endpoint logs a warning and lets the call through. Wire a real auth check
# (e.g. require_admin_jwt) before exposing this route to the public internet.

class GeocodeBackfillRequest(BaseModel):
    dry_run: bool = True
    limit: int = 200
    force: bool = False
    allow_overwrite_user: bool = False
    country: Optional[str] = None


class GeocodeRevertRequest(BaseModel):
    limit: int = 10000
    country: Optional[str] = None


def _check_admin_token(x_admin_token: Optional[str]) -> Optional[Response]:
    expected = os.getenv("ADMIN_TOKEN")
    if not expected:
        # Match the rest of the codebase: log but allow in local dev. The
        # frontend Admin Panel is gated client-side; this endpoint should
        # additionally be reverse-proxy gated in prod.
        print("[admin] WARNING: ADMIN_TOKEN env not set — admin endpoint is unauthenticated.")
        return None
    if x_admin_token != expected:
        return Response("Forbidden", status_code=403)
    return None


from fastapi import Header


@app.post("/api/admin/geocode-licenses")
def admin_geocode_licenses(request: GeocodeBackfillRequest, x_admin_token: Optional[str] = Header(None)):
    """Run a backfill batch.

    Example
    -------
    Preview first 100 missing-coord licenses (no DB writes)::

        curl -X POST http://localhost:8000/api/admin/geocode-licenses \\
             -H 'Content-Type: application/json' \\
             -H "X-Admin-Token: $ADMIN_TOKEN" \\
             -d '{"dry_run": true, "limit": 100}'

    When happy, re-run with ``"dry_run": false`` and a larger limit. Repeated
    calls are idempotent thanks to the ``geo_cache`` table and the
    ``geo_source`` filter.
    """
    forbidden = _check_admin_token(x_admin_token)
    if forbidden is not None:
        return forbidden
    try:
        from geocode_licenses import backfill
    except ImportError:
        # Fall back to in-tree relative import when running with a different
        # PYTHONPATH (e.g. uvicorn with reload from project root).
        import sys, os as _os
        sys.path.insert(0, _os.path.dirname(__file__))
        from geocode_licenses import backfill  # type: ignore
    try:
        stats = backfill(
            dry_run=request.dry_run,
            limit=request.limit,
            force=request.force,
            allow_overwrite_user=request.allow_overwrite_user,
            country_filter=request.country,
        )
        return {
            "status": "success",
            "dry_run": request.dry_run,
            "candidates": stats.candidates,
            "would_update": stats.would_update,
            "updated": stats.updated,
            "not_found": stats.not_found,
            "skipped_user_verified": stats.skipped_user_verified,
            "skipped_no_text": stats.skipped_no_text,
            "cache_hits": stats.cache_hits,
            "network_hits": stats.network_hits,
            "started_at": stats.started_at,
            "finished_at": stats.finished_at,
            "sample": stats.sample,
            "notes": [
                "Set MAPBOX_GEOCODING_TOKEN for higher throughput; otherwise Nominatim is rate-limited to ~1 rps.",
                "Re-run after dry_run=true with dry_run=false to commit changes.",
                "Use POST /api/admin/geocode-licenses/revert to undo any non-user-verified row.",
            ],
        }
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


@app.post("/api/admin/geocode-licenses/revert")
def admin_geocode_revert(request: GeocodeRevertRequest, x_admin_token: Optional[str] = Header(None)):
    """Restore ``original_lat`` / ``original_lng`` for any row touched by a
    backfill run. ``geo_source='user'`` rows are never reverted because they
    have no recorded prior value to restore.
    """
    forbidden = _check_admin_token(x_admin_token)
    if forbidden is not None:
        return forbidden
    try:
        from geocode_licenses import revert_geocoded
    except ImportError:
        import sys, os as _os
        sys.path.insert(0, _os.path.dirname(__file__))
        from geocode_licenses import revert_geocoded  # type: ignore
    try:
        result = revert_geocoded(limit=request.limit, country_filter=request.country)
        return {"status": "success", **result}
    except Exception as exc:
        return {"status": "error", "message": str(exc)}

class ArcGISIngestRequest(BaseModel):
    layer_url: str
    country_map: Optional[str] = "Ghana" # Used for mapping rules
    batch_size: Optional[int] = 1000

@app.post("/api/admin/ingest/arcgis")
def ingest_arcgis_cadastre(request: ArcGISIngestRequest, x_admin_token: Optional[str] = Header(None)):
    """
    Scrapes an ArcGIS REST feature layer and ingests licenses into the database.
    """
    forbidden = _check_admin_token(x_admin_token)
    if forbidden is not None:
        return forbidden

    try:
        from backend.services.ingest.arcgis_adapter import ArcGISCadastreAdapter
        from backend.services.resolve.entity_resolution import EntityResolutionEngine
    except ImportError:
        import sys, os as _os
        sys.path.insert(0, _os.path.dirname(__file__))
        from services.ingest.arcgis_adapter import ArcGISCadastreAdapter
        from services.resolve.entity_resolution import EntityResolutionEngine

    try:
        adapter = ArcGISCadastreAdapter(request.layer_url)
        raw_features = adapter.fetch_all_licenses(batch_size=request.batch_size)
        
        # Determine basic field map based on country (rough mapping)
        field_map = {
            'id': 'OBJECTID',
            'company': 'COMP_NAME',
            'licenseType': 'TYPE',
            'commodity': 'COMMODITY',
            'status': 'STATUS'
        }
        
        if request.country_map.lower() == 'mali':
            field_map['company'] = 'SOCIETE'
            field_map['licenseType'] = 'TYPE_PERMI'
            field_map['status'] = 'STATUT'
            field_map['commodity'] = 'SUBSTANCES'

        conn = get_db_connection()
        cur = conn.cursor()
        
        # Load existing entities for resolution
        cur.execute("SELECT id, company, lat, lng FROM licenses")
        existing_licenses = []
        for row in cur.fetchall():
            existing_licenses.append({"id": row[0], "company": row[1], "lat": row[2], "lng": row[3]})
            
        resolver = EntityResolutionEngine()
        
        inserted = 0
        updated = 0
        
        for feature in raw_features:
            mapped = adapter.map_to_standard_schema(feature, field_map)
            
            # Entity Resolution
            matches = resolver.find_matches(mapped, existing_licenses)
            if matches and matches[0][1] > 0.85:
                # Update existing
                existing_id = matches[0][0]['id']
                cur.execute("""
                    UPDATE licenses 
                    SET company = %s, commodity = %s, license_type = %s, status = %s
                    WHERE id = %s
                """, (mapped.get('company'), mapped.get('commodity'), mapped.get('licenseType'), mapped.get('status'), existing_id))
                updated += 1
            else:
                # Insert new
                if not mapped.get('id'):
                    mapped['id'] = str(uuid.uuid4())
                cur.execute("""
                    INSERT INTO licenses (id, company, commodity, license_type, status, lat, lng, country)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                """, (mapped.get('id'), mapped.get('company'), mapped.get('commodity'), 
                      mapped.get('licenseType'), mapped.get('status'), 
                      mapped.get('lat'), mapped.get('lng'), request.country_map))
                inserted += 1
                
        conn.commit()
        cur.close()
        conn.close()
        
        return {
            "status": "success",
            "message": f"Ingested {len(raw_features)} raw features.",
            "inserted": inserted,
            "updated": updated
        }
    except Exception as exc:
        return {"status": "error", "message": str(exc)}


# ======================================================================
# Logistics Routes  /api/logistics/*
# ======================================================================
# deal_shipments table: one row per shipment leg.
# Mirrors the ShipmentLeg TypeScript type in the frontend.

def _ensure_logistics_table():
    """Create the deal_shipments table if it doesn't already exist."""
    try:
        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("""
            CREATE TABLE IF NOT EXISTS deal_shipments (
                id VARCHAR(255) PRIMARY KEY,
                deal_id VARCHAR(255),
                deal_label TEXT,
                origin TEXT NOT NULL,
                destination TEXT NOT NULL,
                incoterm VARCHAR(10) DEFAULT 'FOB',
                status VARCHAR(50) DEFAULT 'planned',
                eta VARCHAR(50),
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        print(f"[logistics] table init failed: {e}")

_ensure_logistics_table()


class ShipmentCreate(BaseModel):
    deal_id: Optional[str] = None
    deal_label: Optional[str] = None
    origin: str
    destination: str
    incoterm: Optional[str] = "FOB"
    status: Optional[str] = "planned"
    eta: Optional[str] = None
    notes: Optional[str] = None


class ShipmentUpdate(BaseModel):
    deal_id: Optional[str] = None
    deal_label: Optional[str] = None
    origin: Optional[str] = None
    destination: Optional[str] = None
    incoterm: Optional[str] = None
    status: Optional[str] = None
    eta: Optional[str] = None
    notes: Optional[str] = None


@app.get("/api/logistics/shipments")
def list_shipments(deal_id: Optional[str] = None):
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    try:
        if deal_id:
            c.execute(
                "SELECT * FROM deal_shipments WHERE deal_id = %s ORDER BY created_at DESC",
                (deal_id,)
            )
        else:
            c.execute("SELECT * FROM deal_shipments ORDER BY created_at DESC")
        rows = c.fetchall()
        return [
            {
                "id": r["id"],
                "dealId": r["deal_id"],
                "dealLabel": r["deal_label"],
                "origin": r["origin"],
                "destination": r["destination"],
                "incoterm": r["incoterm"],
                "status": r["status"],
                "eta": r["eta"],
                "notes": r["notes"],
                "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
            }
            for r in rows
        ]
    finally:
        conn.close()


@app.post("/api/logistics/shipments")
def create_shipment(item: ShipmentCreate):
    conn = get_db_connection()
    c = conn.cursor()
    new_id = str(uuid.uuid4())
    try:
        c.execute("""
            INSERT INTO deal_shipments
              (id, deal_id, deal_label, origin, destination, incoterm, status, eta, notes)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (
            new_id, item.deal_id, item.deal_label,
            item.origin, item.destination, item.incoterm,
            item.status, item.eta, item.notes,
        ))
        conn.commit()
        return {"id": new_id, "status": "created"}
    except Exception as e:
        conn.rollback()
        return Response(str(e), status_code=500)
    finally:
        conn.close()


@app.put("/api/logistics/shipments/{shipment_id}")
def update_shipment(shipment_id: str, item: ShipmentUpdate):
    conn = get_db_connection()
    c = conn.cursor()
    try:
        updates, values = [], []
        fields = {
            "deal_id": item.deal_id, "deal_label": item.deal_label,
            "origin": item.origin, "destination": item.destination,
            "incoterm": item.incoterm, "status": item.status,
            "eta": item.eta, "notes": item.notes,
        }
        for col, val in fields.items():
            if val is not None:
                updates.append(f"{col} = %s")
                values.append(val)
        if not updates:
            return {"status": "no changes"}
        updates.append("updated_at = CURRENT_TIMESTAMP")
        values.append(shipment_id)
        c.execute(f"UPDATE deal_shipments SET {', '.join(updates)} WHERE id = %s", tuple(values))
        if c.rowcount == 0:
            return Response("Shipment not found", status_code=404)
        conn.commit()
        return {"status": "updated", "id": shipment_id}
    except Exception as e:
        conn.rollback()
        return Response(str(e), status_code=500)
    finally:
        conn.close()


@app.delete("/api/logistics/shipments/{shipment_id}")
def delete_shipment(shipment_id: str):
    conn = get_db_connection()
    c = conn.cursor()
    try:
        c.execute("DELETE FROM deal_shipments WHERE id = %s", (shipment_id,))
        if c.rowcount == 0:
            return Response("Shipment not found", status_code=404)
        conn.commit()
        return {"status": "deleted", "id": shipment_id}
    except Exception as e:
        conn.rollback()
        return Response(str(e), status_code=500)
    finally:
        conn.close()


if __name__ == "__main__":
    import uvicorn
    # Run slightly different port than typical default to avoid collisions if any
    uvicorn.run(app, host="0.0.0.0", port=8000)
