import json
import psycopg2
from shapely.geometry import Point, shape
from shapely.strtree import STRtree

# Load GeoJSON
with open('data/country_borders.geojson') as f:
    geojson = json.load(f)

polygons = []
country_names = []
for f in geojson['features']:
    geom = shape(f['geometry'])
    polygons.append(geom)
    country_names.append(f['properties'].get('name') or f['properties'].get('ADMIN') or 'Unknown')

tree = STRtree(polygons)

conn = psycopg2.connect("dbname=mining_db user=postgres password=password host=db")
cur = conn.cursor()
cur.execute("SELECT id, lat, lng FROM licenses WHERE country = 'Global' LIMIT 10")
rows = cur.fetchall()

for row in rows:
    pid, lat, lng = row
    pt = Point(lng, lat)  # Longitude first for shapely!
    res = tree.query(pt)
    match_name = None
    for idx in res:
        if polygons[idx].contains(pt):
            match_name = country_names[idx]
            break
    print(f"ID: {pid}, Lat: {lat}, Lng: {lng} => {match_name}")

cur.close()
conn.close()
