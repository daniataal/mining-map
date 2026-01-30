import sqlite3

conn = sqlite3.connect('mining.db')
cursor = conn.cursor()
cursor.execute("SELECT region, count(*) as c FROM licenses WHERE country='South Africa' GROUP BY region ORDER BY c DESC LIMIT 30")
for row in cursor.fetchall():
    print(row)
conn.close()
