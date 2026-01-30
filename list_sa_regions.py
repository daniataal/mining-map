import sqlite3
import re

conn = sqlite3.connect('mining.db')
cursor = conn.cursor()

# Get all SA regions
cursor.execute("SELECT region, count(*) as c FROM licenses WHERE country='South Africa' GROUP BY region ORDER BY c DESC LIMIT 100")
results = cursor.fetchall()
conn.close()

for row in results:
    raw = row[0]
    count = row[1]
    # Clean: replace multiple spaces with single space
    clean = re.sub(r'\s+', ' ', raw).strip()
    print(f"{clean}|{count}")
