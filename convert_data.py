import pandas as pd
import json
import os
import re
import sys
from pathlib import Path

_backend = Path(__file__).resolve().parent / "backend"
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

from ghana_location_centroids import LOCATION_MAP

# File paths
INPUT_FILE = r'c:\Users\daney\Downloads\report_license_20012026.xlsx'
OUTPUT_FILE = r'C:\Users\daney\.gemini\antigravity\scratch\mining-map\mining-viz\src\data\licenses.json'

def normalize_col(col):
    return col.strip().lower().replace(" ", "_").replace(".", "")

# Add Jitter to separate markers at same location
import random
def add_jitter(coord):
    return coord + (random.random() - 0.5) * 0.01

def main():
    try:
        print(f"Reading {INPUT_FILE}...")
        df = pd.read_excel(INPUT_FILE)
        
        # Normalize columns
        df.columns = [normalize_col(c) for c in df.columns]
        
        col_map = {}
        # Simple fuzzy match helper
        def find_col(keywords):
            for col in df.columns:
                if any(k in col for k in keywords):
                    return col
            return None

        col_map['id'] = find_col(['code', 'id', 'license_no'])
        col_map['company'] = find_col(['company', 'holder', 'applicant', 'owner'])
        col_map['licenseType'] = find_col(['type', 'status_type'])
        col_map['status'] = find_col(['status', 'state'])
        col_map['commodity'] = find_col(['commodity', 'mineral', 'target'])
        col_map['region_raw'] = find_col(['region', 'district', 'location'])
        col_map['date'] = find_col(['start_date', 'date', 'issued'])
        
        output_data = []
        
        for idx, row in df.iterrows():
            # Basic info
            item = {
                'id': row.get(col_map.get('id')) if col_map.get('id') else str(idx),
                'company': str(row.get(col_map.get('company'))) if col_map.get('company') else "Unknown",
                'licenseType': str(row.get(col_map.get('licenseType'))) if col_map.get('licenseType') else "Unknown",
                'commodity': str(row.get(col_map.get('commodity'))) if col_map.get('commodity') else "Unknown",
                'status': str(row.get(col_map.get('status'))) if col_map.get('status') else "Unknown",
                'date': str(row.get(col_map.get('date'))) if col_map.get('date') else "",
                'country': 'Ghana' # Default
            }

            # Location Parsing
            raw_loc = row.get(col_map.get('region_raw'))
            region_str = str(raw_loc) if not pd.isna(raw_loc) else ""
            item['region'] = region_str
            
            # Try to match location from specific to general
            parts = [p.strip() for p in region_str.split('\n') if p.strip()]
            
            lat, lng = None, None
            matched_loc = None
            
            # Try to match any part of the string to our map
            for part in parts:
                if part in LOCATION_MAP:
                    lat = LOCATION_MAP[part]['lat']
                    lng = LOCATION_MAP[part]['lng']
                    matched_loc = part
                    break
            
            # If no direct match, check if we can fuzzy match keys
            if lat is None:
                for part in parts:
                    for k, v in LOCATION_MAP.items():
                        if k in part or part in k: # loose match
                             lat = v['lat']
                             lng = v['lng']
                             matched_loc = k
                             break
                    if lat: break
            
            if lat and lng:
                item['lat'] = add_jitter(lat)
                item['lng'] = add_jitter(lng)
                item['matched_location'] = matched_loc
            
            # Clean up nan/none
            for k, v in item.items():
                if v == "nan" or v is None:
                    item[k] = ""
            
            output_data.append(item)
            
        print(f"Processed {len(output_data)} rows.")
        mapped_count = sum(1 for x in output_data if 'lat' in x)
        print(f"Successfully geocoded {mapped_count} items.")
        
        os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
        with open(OUTPUT_FILE, 'w') as f:
            json.dump(output_data, f, indent=2)
            
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
