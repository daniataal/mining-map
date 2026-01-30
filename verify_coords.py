import sqlite3

conn = sqlite3.connect('mining.db')
cursor = conn.cursor()
cursor.execute("SELECT id, region, lat, lng FROM licenses WHERE country='South Africa' AND lat IS NOT NULL LIMIT 5")
print(cursor.fetchall())
conn.close()
