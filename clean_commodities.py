import sqlite3
import re

conn = sqlite3.connect('mining.db')
cursor = conn.cursor()

cursor.execute("SELECT id, commodity FROM licenses")
rows = cursor.fetchall()

updated = 0
for row in rows:
    lic_id, raw = row
    if not raw:
        continue
        
    # Clean up whitespace and punctuation
    # 1. Remove newlines and tabs
    clean = str(raw).replace('\n', ' ').replace('\r', ' ').replace('\t', ' ')
    
    # 2. Strip leading/trailing non-alphanumeric (except some?)
    # Users wants simpler chars removed. '.' is a big one.
    clean = clean.strip(' .,;')
    
    # 3. Collapse spaces
    clean = re.sub(r'\s+', ' ', clean)
    
    # 4. Standard Case (Title Case for now, or specific overrides)
    # The GH data is likely "Gold", RSA is "GOLD" or "DIAMONDS ALLUVIAL" (Caps).
    # Let's Capitalize First letter of each word to Title Case nicely?
    # Or keep as is, just cleaned?
    # Let's try to detect if it matches known ones.
    
    # Specific normalization requested by user ("Change them to just the name")
    upper = clean.upper()
    
    new_val = clean
    
    if "GOLD" in upper:
        # If it's just Gold with junk
        if upper in ["GOLD", "GOLD ORE", "GOLD."]:
             new_val = "Gold"
        elif "GOLD" == upper.strip():
             new_val = "Gold"
             
    if "DIAMOND" in upper:
        if "ALLUVIAL" in upper or "KIMBERLITE" in upper:
            # Maybe keep explicit? Or simplify to Diamonds?
            # User said "Just the name of the commodity".
            # "Diamonds Alluvial" is fairly specific. "Gold" vs "Gold." is dupes.
            # I'll stick to cleaning the simple dupes first.
            pass
            
    # Apply the basic cleaning anyway if different
    if new_val != raw:
        cursor.execute("UPDATE licenses SET commodity=? WHERE id=?", (new_val, lic_id))
        updated += 1

conn.commit()
print(f"Updated {updated} records.")
conn.close()
