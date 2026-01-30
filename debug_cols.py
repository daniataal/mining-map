import pandas as pd

INPUT_FILE = r'c:\Users\daney\Downloads\report_license_20012026.xlsx'

def normalize_col(col):
    return col.strip().lower().replace(" ", "_").replace(".", "")

try:
    df = pd.read_excel(INPUT_FILE)
    df.columns = [normalize_col(c) for c in df.columns]
    with open('cols.txt', 'w') as f:
        f.write(str(df.columns.tolist()))
except Exception as e:
    print(e)
