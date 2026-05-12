import requests
headers = {'User-Agent': 'MiningMap/1.0', 'Accept': 'application/sparql-results+json'}
url = 'https://query.wikidata.org/sparql'
query = """
SELECT ?mineLabel ?coord ?countryLabel WHERE {
  ?mine wdt:P31/wdt:P279* wd:Q820477.
  ?mine wdt:P625 ?coord.
  ?mine wdt:P17 ?country.
  ?country wdt:P30 wd:Q15.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 10
"""
response = requests.get(url, params={'query': query}, headers=headers, timeout=30)
data = response.json()
real_mines = []
for item in data['results']['bindings']:
    name = item.get('mineLabel', {}).get('value', 'Unnamed Mine')
    country = item.get('countryLabel', {}).get('value', 'Unknown Country')
    coord_str = item.get('coord', {}).get('value', '')
    if coord_str.startswith("Point("):
        lon_lat = coord_str.replace("Point(", "").replace(")", "").split()
        if len(lon_lat) == 2:
            lon, lat = float(lon_lat[0]), float(lon_lat[1])
            real_mines.append((name, country, "Africa", "Mineral", "OpenData", "ACTIVE", lat, lon))
print(f"Pulled {len(real_mines)} mines: {real_mines}")
