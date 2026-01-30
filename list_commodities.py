import sqlite3

conn = sqlite3.connect('mining.db')
cursor = conn.cursor()

cursor.execute("SELECT DISTINCT commodity FROM licenses ORDER BY commodity")
commodities = [row[0] for row in cursor.fetchall() if row[0]]

print(f"Total unique commodities: {len(commodities)}")
for c in commodities:
    print(f"'{c}'")

conn.close()
