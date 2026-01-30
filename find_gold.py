import sqlite3

conn = sqlite3.connect('mining.db')
cursor = conn.cursor()

# Find anything containing "gold" (case insensitive)
cursor.execute("SELECT commodity, count(*) FROM licenses WHERE commodity LIKE '%gold%' GROUP BY commodity")
for row in cursor.fetchall():
    print(f"{row[1]}: '{row[0]}'")

conn.close()
