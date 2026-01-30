import sqlite3

conn = sqlite3.connect('mining.db')
cursor = conn.cursor()
cursor.execute("SELECT count(*) FROM licenses WHERE country='South Africa' AND lat IS NULL")
print(f"Missing coordinates: {cursor.fetchone()[0]}")

cursor.execute("SELECT DISTINCT region FROM licenses WHERE country='South Africa' LIMIT 20")
print("\nSample Regions:")
for row in cursor.fetchall():
    print(row[0])

conn.close()
