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
                date_issued TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
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


if __name__ == "__main__":
    import uvicorn
    # Run slightly different port than typical default to avoid collisions if any
    uvicorn.run(app, host="0.0.0.0", port=8000)

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
        return {"error": str(e)}
    finally:
        conn.close()
if __name__ == "__main__":
    import uvicorn
    # Run slightly different port than typical default to avoid collisions if any
    uvicorn.run(app, host="0.0.0.0", port=8000)
