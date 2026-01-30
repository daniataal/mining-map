import sqlite3
import json

conn = sqlite3.connect('mining.db')
cursor = conn.cursor()
cursor.execute("SELECT DISTINCT region FROM licenses WHERE country='South Africa'")
regions = [row[0] for row in cursor.fetchall() if row[0]]
conn.close()

# Clean up regions (remove province names like "NORTH-WEST", "NORTHERN CAPE" etc if they are appended)
# From the sample output earlier: "VENTERSDORP                                            NORTH-WEST"
# It seems there is a lot of whitespace.

cleaned_regions = set()
for r in regions:
    # Split by multiple spaces to separate district from province
    parts = [p.strip() for p in r.split('  ') if p.strip()]
    if parts:
        cleaned_regions.add(parts[0])

print(json.dumps(list(cleaned_regions), indent=2))
