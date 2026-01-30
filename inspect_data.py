import pandas as pd
import json

file_path = r'c:\Users\daney\Downloads\report_license_20012026.xlsx'

try:
    df = pd.read_excel(file_path)
    print("Columns:", df.columns.tolist())
    print("First 3 rows:")
    print(df.head(3).to_markdown())
    
    # Check for likely coordinate columns
    possible_lat = [c for c in df.columns if 'lat' in c.lower()]
    possible_lon = [c for c in df.columns if 'lon' in c.lower() or 'lng' in c.lower()]
    print("Possible Latitude columns:", possible_lat)
    print("Possible Longitude columns:", possible_lon)

except Exception as e:
    print("Error reading Excel file:", e)
