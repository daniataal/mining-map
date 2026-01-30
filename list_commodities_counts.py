import sqlite3
import re

conn = sqlite3.connect('mining.db')
cursor = conn.cursor()

cursor.execute("SELECT commodity, count(*) as c FROM licenses GROUP BY commodity ORDER BY c DESC LIMIT 100")
results = cursor.fetchall()

print("Top 100 commodities (raw):")
for row in results:
    print(f"{row[1]}: '{row[0]}'")

conn.close()
