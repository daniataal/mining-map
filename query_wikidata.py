import requests
import json

url = 'https://query.wikidata.org/sparql'
query = """
SELECT ?mine ?mineLabel ?coord ?countryLabel WHERE {
  ?mine wdt:P31/wdt:P279* wd:Q1165146.
  ?mine wdt:P625 ?coord.
  ?mine wdt:P17 ?country.
  ?country wdt:P30 wd:Q15.
  SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
}
LIMIT 100
"""
headers = {'User-Agent': 'MiningMapBot/1.0', 'Accept': 'application/sparql-results+json'}
r = requests.get(url, params={'query': query}, headers=headers)
print(json.dumps(r.json()['results']['bindings'][:5], indent=2))
