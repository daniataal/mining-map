import sqlite3

conn = sqlite3.connect('mining.db')
cursor = conn.cursor()

# Check for ID 15752 or similar
print("Checking for ID 15752:")
cursor.execute("SELECT id, company FROM licenses WHERE id LIKE '%15752%'")
for row in cursor.fetchall():
    print(f"Found: '{row[0]}' - {row[1]}")

# Check exact match
cursor.execute("SELECT count(*) FROM licenses WHERE id = '15752'")
print(f"Exact match count: {cursor.fetchone()[0]}")

# Check with whitespace
cursor.execute("SELECT count(*) FROM licenses WHERE id = '15752 '")
print(f"Match with space: {cursor.fetchone()[0]}")

conn.close()
