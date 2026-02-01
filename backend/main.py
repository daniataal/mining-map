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

def init_db():
    try:
        conn = get_db_connection()
        cur = conn.cursor()
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
            
            CREATE TABLE IF NOT EXISTS license_files (
                id VARCHAR(255) PRIMARY KEY,
                license_id VARCHAR(255) NOT NULL,
                filename TEXT NOT NULL,
                file_path TEXT NOT NULL,
                upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE
            );
        """)
        conn.commit()
        cur.close()
        conn.close()
        print("Database initialized successfully.")
    except Exception as e:
        print(f"Failed to initialize database: {e}")

# Initialize DB on startup
init_db()

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
