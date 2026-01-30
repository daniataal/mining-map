from fastapi import FastAPI, UploadFile, File, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import sqlite3
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

# Database file is one level up
# Database file is one level up
if os.getenv("MINING_DB_PATH"):
    DB_PATH = os.getenv("MINING_DB_PATH")
else:
    DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "mining.db")

def get_db_connection():
    print(f"Connecting to DB at: {DB_PATH}")
    if os.path.exists(DB_PATH):
        if os.path.isdir(DB_PATH):
             print(f"CRITICAL ERROR: {DB_PATH} is a DIRECTORY, not a file.")
        else:
             print(f"File exists. Permissions: R={os.access(DB_PATH, os.R_OK)}, W={os.access(DB_PATH, os.W_OK)}")
             # Try to touch the file
             try:
                 with open(DB_PATH, 'a'):
                     os.utime(DB_PATH, None)
                 print("Successfully touched DB file (Write check passed).")
             except Exception as e:
                 print(f"Failed to write/touch DB file: {e}")
    else:
        print(f"File does not exist at {DB_PATH}")

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row # This allows access by column name
    return conn

@app.get("/licenses")
def read_licenses():
    if not os.path.exists(DB_PATH):
        return {"error": "Database not found. Run push_to_sql.py first."}
    
    conn = get_db_connection()
    c = conn.cursor()
    
    # Select all rows
    try:
        c.execute("SELECT * FROM licenses")
        rows = c.fetchall()
    except sqlite3.OperationalError as e:
        conn.close()
        return {"error": f"Database error (likely missing tables): {str(e)}. Please ensure mining.db is populated."}
    
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
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    print(f"DB Path: {DB_PATH}")
    
    conn = get_db_connection()
    c = conn.cursor()
    
    # Check if exists first for debugging
    c.execute("SELECT * FROM licenses WHERE id = ?", (license_id,))
    found = c.fetchone()
    print(f"Record found before delete: {found is not None}")
    if found:
        print(f"Record: {tuple(found)}")

    c.execute("DELETE FROM licenses WHERE id = ?", (license_id,))
    conn.commit()
    deleted = c.rowcount
    print(f"Rows deleted: {deleted}")
    conn.close()
    
    if deleted == 0:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"License {license_id} not found in {DB_PATH}")
        
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
    placeholders = ','.join('?' * len(request.ids))
    sql = f"DELETE FROM licenses WHERE id IN ({placeholders})"
    
    try:
        c.execute(sql, request.ids)
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
    c = conn.cursor()
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
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ''', rows_to_insert)
        conn.commit()
        count = c.rowcount
    except Exception as e:
        conn.close()
        return {"status": "error", "message": str(e)}
        
    conn.close()
    return {"status": "success", "imported_count": count}
if __name__ == "__main__":
    import uvicorn
    # Run slightly different port than typical default to avoid collisions if any
    uvicorn.run(app, host="0.0.0.0", port=8000)
