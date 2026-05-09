from fastapi import FastAPI, UploadFile, File, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import psycopg2
from psycopg2.extras import RealDictCursor
import time
import os
import csv
import io
import uuid
from pydantic import BaseModel
from typing import Optional

app = FastAPI()

# Allow CORS for local development (so React/Vite can fetch from us)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # For dev only. In prod, list the frontend domain.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Database connection parameters
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_NAME = os.getenv("DB_NAME", "mining_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "password")

def get_db_connection():
    # Simple retry logic for container startup
    retries = 5
    while retries > 0:
        try:
            conn = psycopg2.connect(
                host=DB_HOST,
                database=DB_NAME,
                user=DB_USER,
                password=DB_PASSWORD
            )
            return conn
        except psycopg2.OperationalError as e:
            print(f"Waiting for DB... ({5-retries}/5)")
            time.sleep(2)
            retries -= 1
            if retries == 0:
                raise e

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
def delete_user(user_id: str):
    # Prevent deleting the last admin or specific generic admin if needed
    conn = get_db_connection()
    c = conn.cursor()
    try:
        # Optional: check if user exists first
        c.execute("DELETE FROM users WHERE id = %s", (user_id,))
        if c.rowcount == 0:
             return Response("User not found", status_code=404)
        conn.commit()
        return {"status": "deleted"}
    except Exception as e:
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
def read_licenses():
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    
    # Select all rows
    try:
        c.execute("SELECT * FROM licenses")
        rows = c.fetchall()
    except Exception as e:
        conn.close()
        return {"error": f"Database error: {str(e)}"}
    
    conn.close()
    
    # Transform to list of dicts with keys matching what the Reac app expects
    results = []
    for row in rows:
        results.append({
            "id": row["id"],
            "company": row["company"],
            "licenseType": row["license_type"], # Frontend expects camelCase
            "commodity": row["commodity"],
            "status": row["status"],
            "date": row["date_issued"],        # Frontend expects 'date'
            "country": row["country"],
            "region": row["region"],
            "lat": row["lat"],
            "lng": row["lng"],
            "phoneNumber": row["phone_number"] if "phone_number" in row.keys() else None,
            "contactPerson": row["contact_person"] if "contact_person" in row.keys() else None
        })
    
    return results

from pydantic import BaseModel
from typing import Optional

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
            conn.commit() # Commit the update first
            
            c.execute("SELECT * FROM licenses WHERE id = %s", (license_id,))
            updated_row = c.fetchone()
            
            if export_license_to_marketplace(updated_row):
                c.execute("UPDATE licenses SET is_exported = TRUE WHERE id = %s", (license_id,))
                conn.commit()
                return {"status": "updated", "exported": True}
        else:
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

@app.get("/licenses/export")
def export_licenses():
    conn = get_db_connection()
    c = conn.cursor(cursor_factory=RealDictCursor)
    c.execute("SELECT * FROM licenses")
    rows = c.fetchall()
    conn.close()

    output = io.StringIO()
    writer = csv.writer(output)
    
    # Write Header
    headers = ["id", "company", "country", "region", "commodity", "license_type", "status", "lat", "lng", "phone_number", "contact_person", "date_issued"]
    writer.writerow(headers)
    
    # Write Data
    for row in rows:
        writer.writerow([
            row["id"], row["company"], row["country"], row["region"], row["commodity"], 
            row["license_type"], row["status"], row["lat"], row["lng"], 
            row["phone_number"], row["contact_person"], row["date_issued"]
        ])
    
    output.seek(0)
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=licenses_export.csv"
    return response

@app.get("/licenses/template")
def get_template():
    output = io.StringIO()
    writer = csv.writer(output)
    # Required/Standard Headers
    headers = ["company", "country", "region", "commodity", "license_type", "status", "lat", "lng", "phone_number", "contact_person"]
    writer.writerow(headers)
    writer.writerow(["Example Mining Co", "Ghana", "Ashanti", "Gold", "Large Scale", "Operating", "6.5", "-1.5", "+233...", "John Doe"])
    
    output.seek(0)
    response = StreamingResponse(iter([output.getvalue()]), media_type="text/csv")
    response.headers["Content-Disposition"] = "attachment; filename=import_template.csv"
    return response

@app.post("/licenses/import")
async def import_licenses(file: UploadFile = File(...)):
    content = await file.read()
    try:
        decoded = content.decode('utf-8')
    except UnicodeDecodeError:
        # Fallback to latin-1 if utf-8 fails
        decoded = content.decode('latin-1')
        
    csv_reader = csv.DictReader(io.StringIO(decoded))
    
    rows_to_insert = []
    
    for row in csv_reader:
        # Basic validation
        if not row.get("company") or not row.get("lat") or not row.get("lng"):
            continue
            
        rows_to_insert.append((
            str(uuid.uuid4()), # Generate new ID
            row.get("company"),
            row.get("country", "Ghana"),
            row.get("region", ""),
            row.get("commodity", ""),
            row.get("license_type", "Unknown"),
            row.get("status", "Unknown"),
            float(row.get("lat", 0)),
            float(row.get("lng", 0)),
            row.get("phone_number", ""),
            row.get("contact_person", ""),
            None # date_issued
        ))
        
    if not rows_to_insert:
        return {"status": "error", "message": "No valid rows found or file is empty"}

    conn = get_db_connection()
    c = conn.cursor()
    
    try:
        c.executemany('''
            INSERT INTO licenses 
            (id, company, country, region, commodity, license_type, status, lat, lng, phone_number, contact_person, date_issued)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        ''', rows_to_insert)
        conn.commit()
        count = c.rowcount
    except Exception as e:
        conn.close()
        return {"status": "error", "message": str(e)}
        
    conn.close()
    return {"status": "success", "imported_count": count}

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
    Executes the AI Waterfall. 
    Cascade: Groq -> OpenRouter -> Pollinations (Free Proxy)
    """
    providers = [
        {"name": "Groq", "url": "https://api.groq.com/openai/v1/chat/completions", "key": os.getenv("GROQ_API_KEY")},
        {"name": "OpenRouter", "url": "https://openrouter.ai/api/v1/chat/completions", "key": os.getenv("OPENROUTER_API_KEY")}
    ]

    system_prompt = (
        "You are an advisor on West African mining licenses for experienced buyers. "
        "Decide GO / NO GO with evidence, not hype. Give a risk score 1–10 (10 = do not proceed). "
        "Cover: local discount potential, logistics, license validity/compliance. "
        "Reply in Markdown only. Use ## for main sections. Keep paragraphs short (2–4 sentences). "
        "Put basic facts in bullets, not huge tables. Use one compact table only for risk breakdown "
        "(Category | Score | One-line rationale). Number tactical steps. "
        "Call out what must be verified with regulators. Tone: direct, scannable, plain language."
    )

    # Attempt Cascade
    import requests
    for provider in providers:
        if provider["key"]:
            try:
                headers = {"Authorization": f"Bearer {provider['key']}", "Content-Type": "application/json"}
                payload = {
                    "model": "llama3-70b-8192" if provider["name"] == "Groq" else "meta-llama/llama-3-8b-instruct:free",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": request.query}
                    ]
                }
                response = requests.post(provider["url"], headers=headers, json=payload, timeout=10)
                if response.status_code == 200:
                    data = response.json()
                    content = data['choices'][0]['message']['content']
                    return {"status": "success", "provider": provider["name"], "analysis": content}
            except Exception as e:
                print(f"Provider {provider['name']} failed: {e}")

    # Ultimate Fallback (Free Proxy)
    try:
        url = f"https://text.pollinations.ai/{requests.utils.quote(system_prompt + ' ' + request.query)}"
        response = requests.get(url, timeout=20)
        return {"status": "success", "provider": "Pollinations (Fallback)", "analysis": response.text}
    except:
        return {"status": "error", "message": "All intelligence providers are offline."}

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
    {"symbol": "XAU/USD", "price": "3,327.45", "change": "+0.45%", "up": True},
    {"symbol": "XAG/USD", "price": "32.80",    "change": "-0.12%", "up": False},
    {"symbol": "BTC/USD", "price": "103,200.00","change": "+1.85%", "up": True},
    {"symbol": "BRENT",   "price": "64.20",    "change": "+0.72%", "up": True},
]

@app.get("/market-prices")
def get_market_prices():
    """
    Fetches live commodity benchmarks via free public APIs.
    Falls back gracefully — never returns a 500.
    """
    try:
        results = []

        # Gold & Silver via open.er-api (metals endpoint — free, no auth)
        metals_res = _requests.get(
            "https://api.metals.live/v1/spot",
            timeout=5
        )
        if metals_res.status_code == 200:
            metals = metals_res.json()
            # metals.live returns a list of dicts: [{"gold": 3327.4}, {"silver": 32.8}, ...]
            metals_map = {}
            for entry in metals:
                metals_map.update(entry)

            gold_price = metals_map.get("gold", 3327.45)
            silver_price = metals_map.get("silver", 32.80)

            results.append({"symbol": "XAU/USD", "price": f"{gold_price:,.2f}", "change": "LIVE", "up": True})
            results.append({"symbol": "XAG/USD", "price": f"{silver_price:,.2f}", "change": "LIVE", "up": True})
        else:
            results += FALLBACK_PRICES[:2]

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

        # Brent Crude — use metals.live if available, else fallback
        brent_price = metals_map.get("brent crude", None) if 'metals_map' in dir() else None
        if brent_price:
            results.append({"symbol": "BRENT", "price": f"{brent_price:,.2f}", "change": "LIVE", "up": True})
        else:
            results.append(FALLBACK_PRICES[3])

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


if __name__ == "__main__":
    import uvicorn
    # Run slightly different port than typical default to avoid collisions if any
    uvicorn.run(app, host="0.0.0.0", port=8000)
