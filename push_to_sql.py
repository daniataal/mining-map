import sqlite3
import json
import os

DB_NAME = "mining.db"
# Path to the processed JSON file from convert_data.py
JSON_FILE = r'C:\Users\daney\.gemini\antigravity\scratch\mining-map\mining-viz\src\data\licenses.json'

def init_db():
    """Initialize the database and create the table."""
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    
    # Create table formatted for the product's needs
    # adapting schema from the json keys
    c.execute('''
        CREATE TABLE IF NOT EXISTS licenses (
            id TEXT PRIMARY KEY,
            company TEXT,
            license_type TEXT,
            commodity TEXT,
            status TEXT,
            date_issued TEXT,
            country TEXT,
            region TEXT,
            lat REAL,
            lng REAL,
            matched_location TEXT
        )
    ''')
    conn.commit()
    return conn

def load_data(conn):
    """Load data from JSON into the database."""
    if not os.path.exists(JSON_FILE):
        print(f"Error: {JSON_FILE} not found. Please run convert_data.py first.")
        return

    print(f"Reading data from {JSON_FILE}...")
    with open(JSON_FILE, 'r') as f:
        data = json.load(f)
    
    c = conn.cursor()
    
    # clear existing data to avoid duplicates/stale data
    c.execute('DELETE FROM licenses')
    
    count = 0
    for item in data:
        try:
            c.execute('''
                INSERT OR REPLACE INTO licenses 
                (id, company, license_type, commodity, status, date_issued, country, region, lat, lng, matched_location)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                item.get('id'),
                item.get('company'),
                item.get('licenseType'), # Note: JSON key is licenseType, DB col is license_type
                item.get('commodity'),
                item.get('status'),
                item.get('date'),
                item.get('country'),
                item.get('region'),
                item.get('lat'),     # Can be None/Null
                item.get('lng'),     # Can be None/Null
                item.get('matched_location')
            ))
            count += 1
        except Exception as e:
            print(f"Error inserting item {item.get('id')}: {e}")

    conn.commit()
    print(f"Successfully inserted {count} records into {DB_NAME}.")

def verify_data(conn):
    """Just a quick verification print."""
    c = conn.cursor()
    c.execute('SELECT company, license_type, lat, lng FROM licenses WHERE lat IS NOT NULL LIMIT 3')
    rows = c.fetchall()
    print("\nSample Data (Geocoded):")
    for row in rows:
        print(row)

if __name__ == '__main__':
    conn = init_db()
    load_data(conn)
    verify_data(conn)
    conn.close()
