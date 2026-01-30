import pandas as pd
import json
import os
import re

# File paths
INPUT_FILE = r'c:\Users\daney\Downloads\report_license_20012026.xlsx'
OUTPUT_FILE = r'C:\Users\daney\.gemini\antigravity\scratch\mining-map\mining-viz\src\data\licenses.json'

# Approximate coordinates for Ghana Districts/Regions
# This is a best-effort lookup table.
LOCATION_MAP = {
    "Accra": {"lat": 5.6037, "lng": -0.1870},
    "Accra District": {"lat": 5.6037, "lng": -0.1870},
    "Accra Metropolitan District": {"lat": 5.6037, "lng": -0.1870},
    "Greater Accra Region": {"lat": 5.8058, "lng": 0.0384},
    
    "Kumasi": {"lat": 6.6885, "lng": -1.6244},
    "Kumasi District": {"lat": 6.6885, "lng": -1.6244},
    "Ashanti Region": {"lat": 6.7470, "lng": -1.5209},
    "Obuasi": {"lat": 6.2023, "lng": -1.6766},
    "Obuasi District": {"lat": 6.2023, "lng": -1.6766},
    "Adansi North District": {"lat": 6.2833, "lng": -1.5333},
    "Adansi South District": {"lat": 6.1333, "lng": -1.5000},
    
    "Western Region": {"lat": 5.6548, "lng": -2.1856},
    "Sekondi Takoradi District": {"lat": 4.9016, "lng": -1.7831},
    "Takoradi": {"lat": 4.9016, "lng": -1.7831},
    "Tarkwa": {"lat": 5.3000, "lng": -1.9833},
    "Tarkwa Nsuaem District": {"lat": 5.3000, "lng": -1.9833},
    "Prestea Huni Valley District": {"lat": 5.4333, "lng": -2.1333},
    "Wassa Amenfi Central District": {"lat": 5.6167, "lng": -2.1667},
    "Wassa Amenfi East District": {"lat": 5.8000, "lng": -2.0000},
    "Wassa Amenfi West District": {"lat": 5.7500, "lng": -2.4167},
    "Wassa West District": {"lat": 5.3000, "lng": -2.0000}, # Roughly Tarkwa area
    "Ellembelle District": {"lat": 4.9833, "lng": -2.3333},
    "Jomoro District": {"lat": 5.0833, "lng": -2.6500},
    "Nzema East District": {"lat": 4.9667, "lng": -2.2667},
    "Bibiani/Anwiaso/Bekwai District": {"lat": 6.4500, "lng": -2.3333},
    "Sefwi Wiawso District": {"lat": 6.2000, "lng": -2.4833},
    "Aowin/Suaman District": {"lat": 5.7500, "lng": -2.6667},
    
    "Eastern Region": {"lat": 6.4258, "lng": -0.3700},
    "Koforidua": {"lat": 6.0945, "lng": -0.2608},
    "Koforidua District": {"lat": 6.0945, "lng": -0.2608},
    "Birim North District": {"lat": 6.3500, "lng": -1.0000},
    "Kwaebibirem District": {"lat": 6.0667, "lng": -0.8500},
    "Atiwa District": {"lat": 6.2167, "lng": -0.6000},
    "Denkyembour District": {"lat": 6.0833, "lng": -0.8667},
    "Fanteakwa District": {"lat": 6.3333, "lng": -0.4667},
    "Yilo Krobo District": {"lat": 6.2000, "lng": -0.1667},
    "Lower Manya District": {"lat": 6.1333, "lng": 0.0333},
    "Upper Manya District": {"lat": 6.3667, "lng": -0.0667},
    "Asuogyaman District": {"lat": 6.3333, "lng": 0.1167},
    "Akwapim South District": {"lat": 5.8667, "lng": -0.3167},
    "West Akim Municipal District": {"lat": 5.9667, "lng": -0.6333},
    "East Akim Municipal District": {"lat": 6.2333, "lng": -0.5333},
    
    "Central Region": {"lat": 5.5505, "lng": -1.3328},
    "Cape Coast": {"lat": 5.1053, "lng": -1.2466},
    "Cape Coast District": {"lat": 5.1053, "lng": -1.2466},
    "Assin North District": {"lat": 5.6167, "lng": -1.3333},
    "Assin South District": {"lat": 5.5000, "lng": -1.2000},
    "Upper Denkyira East District": {"lat": 5.9500, "lng": -1.8833},
    "Upper Denkyira West District": {"lat": 6.0500, "lng": -2.0667},
    "Abura/Asebu/Kwamankese District": {"lat": 5.2500, "lng": -1.1833},
    "Mfantsiman  Municipality District": {"lat": 5.2667, "lng": -1.1000},
    "Komenda/Edina Eguafo/Abrem District": {"lat": 5.1000, "lng": -1.4500},
    "Agona East District": {"lat": 5.6000, "lng": -0.7333},
    "Asikuma/Odoben/Brakwa District": {"lat": 5.7000, "lng": -0.9667},
    "Twifo/Heman/Lower Denkyira District": {"lat": 5.7333, "lng": -1.6500},
    
    "Brong Ahafo Region": {"lat": 7.5821, "lng": -1.9351}, # Split now, but for legacy
    "Bono Region": {"lat": 7.5821, "lng": -1.9351},
    "Ahafo Region": {"lat": 6.9167, "lng": -2.5000},
    "Bono East Region": {"lat": 7.7500, "lng": -1.0000},
    "Sunyani District": {"lat": 7.3333, "lng": -2.3167},
    "Sunyani Municipal District": {"lat": 7.3333, "lng": -2.3167},
    "Asutifi North District": {"lat": 6.9667, "lng": -2.3833},
    "Asutifi South District": {"lat": 6.8500, "lng": -2.4500},
    "Tano North District": {"lat": 7.2167, "lng": -2.2000},
    "Tano South District": {"lat": 7.1000, "lng": -2.0500},
    "Wenchi Municipal District": {"lat": 7.7333, "lng": -2.1000},
    "Techiman District": {"lat": 7.5833, "lng": -1.9333},
    "Dormaa Municipal District": {"lat": 7.2833, "lng": -2.8833},
    
    "Northern Region": {"lat": 9.5439, "lng": -0.9057},
    "Tamale District": {"lat": 9.4075, "lng": -0.8534},
    "Bole District": {"lat": 9.0333, "lng": -2.4833},
    "Zabzugu District": {"lat": 9.2833, "lng": 0.3667},
    
    "Upper East Region": {"lat": 10.7042, "lng": -0.5401},
    "Bolgatanga District": {"lat": 10.7856, "lng": -0.8514},
    "Bawku Municipal District": {"lat": 11.0616, "lng": -0.2417},
    "Bawku West District": {"lat": 10.9333, "lng": -0.4667},
    "Talensi District": {"lat": 10.7000, "lng": -0.7000},
    "Kassena Nankana West District": {"lat": 10.9000, "lng": -1.3333},
    "Kassena Nankana East District": {"lat": 10.8833, "lng": -1.0833},

    "Upper West Region": {"lat": 10.2789, "lng": -2.1648},
    "Wa District": {"lat": 10.0600, "lng": -2.5019},
    "Wa Municipal District": {"lat": 10.0600, "lng": -2.5019},
    "Wa East District": {"lat": 10.1667, "lng": -2.0000},
    "Lawra District": {"lat": 10.6333, "lng": -2.9000},
    "Jirapa District": {"lat": 10.5333, "lng": -2.7000},
    "Lambussie-Karni District": {"lat": 10.9167, "lng": -2.6667},
    "Nadowli District": {"lat": 10.3667, "lng": -2.6667},
    
    "Volta Region": {"lat": 6.8833, "lng": 0.3667},
    "Ho District": {"lat": 6.6008, "lng": 0.4713},
    "Ketu South District": {"lat": 6.1000, "lng": 1.1500},
    "South Tongu District": {"lat": 6.0000, "lng": 0.6167},
    "Akatsi South District": {"lat": 6.1167, "lng": 0.8000},
    
    "Oti Region": {"lat": 7.9000, "lng": 0.4000}, 
    "Western North Region": {"lat": 6.3000, "lng": -2.8000},
    "Savannah Region": {"lat": 9.0833, "lng": -1.8167},
    "North East Region": {"lat": 10.5167, "lng": -0.3667},
}

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
