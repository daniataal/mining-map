import pandas as pd
import json

INPUT_FILE = r'c:\Users\daney\Downloads\report_license_20012026.xlsx'

def normalize_col(col):
    return col.strip().lower().replace(" ", "_").replace(".", "")

try:
    df = pd.read_excel(INPUT_FILE)
    df.columns = [normalize_col(c) for c in df.columns]
    
    unique_regions = df['regions'].dropna().unique().tolist()
    
    districts = set()
    for item in unique_regions:
        parts = [p.strip() for p in str(item).split('\n') if p.strip()]
        for p in parts:
            districts.add(p)
                
    with open('districts_clean.json', 'w') as f:
        json.dump(list(districts), f, indent=2)
    
except Exception as e:
    print(e)
