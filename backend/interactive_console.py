# interactive_console.py
# Run this script via: python interactive_console.py
# Ensure you are in the mining-map/backend directory.

import code
import psycopg2
from psycopg2.extras import RealDictCursor
import os
import sys

# Assume the same setup as main.py
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_NAME = os.getenv("DB_NAME", "postgres")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DB_PORT = os.getenv("DB_PORT", "5432")

def get_db_connection():
    try:
        conn = psycopg2.connect(
            host=DB_HOST,
            database=DB_NAME,
            user=DB_USER,
            password=DB_PASSWORD,
            port=DB_PORT
        )
        return conn
    except Exception as e:
        print(f"Error connecting to DB: {e}")
        sys.exit(1)

conn = get_db_connection()
c = conn.cursor(cursor_factory=RealDictCursor)

print("""
===================================================
Welcome to the Mining Map Interactive DB Console!
Powered by Python's built-in REPL.
===================================================

Available Globals:
- 'conn': The psycopg2 connection.
- 'c': A RealDictCursor for executing queries.

Example usage:
    c.execute("SELECT * FROM users")
    users = c.fetchall()
    print(users)

    # Don't forget to commit if you make changes!
    conn.commit()

Type 'exit()' or press Ctrl+D to quit.
""")

# Setup the local environment for the REPL
local_env = {
    'conn': conn,
    'c': c,
    'psycopg2': psycopg2
}

try:
    code.interact(local=local_env)
finally:
    c.close()
    conn.close()
    print("Database connection closed. Goodbye!")
