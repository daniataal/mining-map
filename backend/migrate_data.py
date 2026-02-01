import sqlite3
import psycopg2
import os
import sys

# Configuration
SQLITE_DB = "mining.db"
PG_HOST = os.getenv("DB_HOST", "localhost")
PG_DB = os.getenv("DB_NAME", "mining_db")
PG_USER = os.getenv("DB_USER", "postgres")
PG_PASS = os.getenv("DB_PASSWORD", "password")

def get_sqlite_conn():
    path = os.path.join(os.path.dirname(os.path.dirname(__file__)), SQLITE_DB)
    if not os.path.exists(path):
        print(f"SQLite DB not found at {path}")
        return None
    return sqlite3.connect(path)

def get_pg_conn():
    try:
        return psycopg2.connect(
            host=PG_HOST,
            database=PG_DB,
            user=PG_USER,
            password=PG_PASS
        )
    except Exception as e:
        print(f"Failed to connect to Postgres: {e}")
        return None

def migrate():
    print("Starting migration...")
    
    # Connect SQLite
    sqlite_conn = get_sqlite_conn()
    if not sqlite_conn:
        return

    # Connect Postgres
    pg_conn = get_pg_conn()
    if not pg_conn:
        return

    # Read from SQLite
    print("Reading from SQLite...")
    sqlite_cur = sqlite_conn.cursor()
    try:
        sqlite_cur.execute("SELECT * FROM licenses")
        rows = sqlite_cur.fetchall()
        columns = [description[0] for description in sqlite_cur.description]
    except Exception as e:
        print(f"Error reading SQLite: {e}")
        return

    print(f"Found {len(rows)} rows.")

    # Write to Postgres
    pg_cur = pg_conn.cursor()
    
    # Ensure table exists (backend should handle this, but for safety)
    # columns: id, company, country, region, commodity, license_type, status, lat, lng, phone_number, contact_person, date_issued
    
    # We map columns explicitly to be safe
    # SQLite schema might differ slightly from new Postgres schema if we changed names
    # But current schema in main.py matches SQLite schema mostly.
    
    successor_count = 0
    for row in rows:
        row_dict = dict(zip(columns, row))
        
        # Prepare values
        # Handle potential key differences if any. 
        # main.py SQLite: license_type, phone_number, etc.
        # main.py Postgres: same.
        
        try:
            pg_cur.execute("""
                INSERT INTO licenses (
                    id, company, country, region, commodity, license_type, 
                    status, lat, lng, phone_number, contact_person, date_issued
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
            """, (
                row_dict.get('id'),
                row_dict.get('company'),
                row_dict.get('country'),
                row_dict.get('region'),
                row_dict.get('commodity'),
                row_dict.get('license_type'),
                row_dict.get('status'),
                row_dict.get('lat'),
                row_dict.get('lng'),
                row_dict.get('phone_number'),
                row_dict.get('contact_person'),
                row_dict.get('date_issued')
            ))
            successor_count += 1
        except Exception as e:
            print(f"Failed to insert row {row_dict.get('id')}: {e}")
            pg_conn.rollback() 
            continue
            
    pg_conn.commit()
    print(f"Migration complete. Inserted {successor_count} rows.")
    
    sqlite_conn.close()
    pg_conn.close()

if __name__ == "__main__":
    migrate()
