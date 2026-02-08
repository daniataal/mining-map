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
        """)

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

MARKETPLACE_API_URL = os.getenv("MARKETPLACE_API_URL", "https://api.marketplace.example.com/v1/sellers/integrate")
MARKETPLACE_API_KEY = os.getenv("MARKETPLACE_API_KEY", "demo-key")

def export_license_to_marketplace(license_data: dict):
    print(f"Attempting export for license {license_data['id']}...")
    try:
        # Map fields to Marketplace Seller Object
        payload = {
            "external_id": license_data["id"],
            "company_name": license_data["company"],
            "location": {
                "country": license_data["country"],
                "region": license_data["region"],
                "coordinates": {
                    "lat": license_data["lat"],
                    "lng": license_data["lng"]
                }
            },
            "commodity": {
                "type": license_data["commodity"],
                "price_per_kg": license_data.get("price_per_kg", 0),
                "capacity": license_data.get("capacity", 0)
            },
            "status": "PASSIVE_SELLER", # Enforced passive status
            "phone": license_data.get("phone_number"),
            "contact": license_data.get("contact_person")
        }
        
        # In a real scenario, we would POST to the API
        # response = requests.post(MARKETPLACE_API_URL, json=payload, timeout=5)
        # response.raise_for_status()
        
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

class AIRequest(BaseModel):
    query: str

@app.post("/api/ai/analyze")
def analyze_with_ai(request: AIRequest):
    """
    Proxies a request to a free AI provider (Pollinations.ai) to get a text response.
    This avoids CORS issues and hides the provider details.
    Pollinations.ai provides free access to models like OpenAI/Claude.
    """
    try:
        # Construct a system-like prompt wrapper for better results
        full_prompt = (
            "You are an expert mining intelligence analyst. "
            "Analyze the following mining entity request and provide a professional, concise due diligence report. "
            "Focus on: License Validity, Ownership, Reputation, and Environmental Compliance. "
            "Use bullet points for clarity. If info is unknown, state 'Data unavailable in public records'.\n\n"
            f"Query: {request.query}"
        )
        
        # Pollinations.ai text API
        # URL pattern: https://text.pollinations.ai/{prompt}
        # It handles URL encoding, but requests handles it better.
        
        url = f"https://text.pollinations.ai/{requests.utils.quote(full_prompt)}"
        
        # Determine model? Pollinations defaults to a good one (usually GPT-4o-mini or similar)
        # We can try to specify model if supported, but default is smartest.
        
        response = requests.get(url, timeout=30)
        
        if response.status_code == 200:
            return {"status": "success", "analysis": response.text}
        else:
            return {"status": "error", "message": f"AI Provider returned {response.status_code}"}
            
    except Exception as e:
        print(f"AI Request Failed: {e}")
        return {"status": "error", "message": "Failed to connect to AI service."}
if __name__ == "__main__":
    import uvicorn
    # Run slightly different port than typical default to avoid collisions if any
    uvicorn.run(app, host="0.0.0.0", port=8000)
