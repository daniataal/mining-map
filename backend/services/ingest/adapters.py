import os
import requests
import logging
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

class AISStreamAdapter:
    """Adapter for AISStream to track maritime vessels."""
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv("AISSTREAM_API_KEY")

    def get_vessel_data(self, bounding_box: List[List[float]]) -> List[Dict[str, Any]]:
        if not self.api_key:
            logger.warning("No AISStream API key provided. Returning mock data.")
            return [{"mmsi": 123456789, "ship_name": "MOCK TANKER", "lat": bounding_box[0][0], "lng": bounding_box[0][1]}]
        # Implementation for real websocket/API connection would go here
        return []

class GDELTAdapter:
    """Adapter for GDELT to fetch news events."""
    def get_recent_events(self, query: str) -> List[Dict[str, Any]]:
        # GDELT has open APIs
        try:
            # Example endpoint: https://api.gdeltproject.org/api/v2/doc/doc?query=mining&mode=artlist&format=json
            url = f"https://api.gdeltproject.org/api/v2/doc/doc?query={requests.utils.quote(query)}&mode=artlist&format=json"
            res = requests.get(url, timeout=10)
            if res.status_code == 200:
                data = res.json()
                return data.get("articles", [])
        except Exception as e:
            logger.error(f"GDELT fetch error: {e}")
        return [{"title": f"Mock News Event for {query}", "url": "http://example.com"}]

class CopernicusAdapter:
    """Adapter for Copernicus / Sentinel data."""
    def get_satellite_imagery(self, lat: float, lng: float) -> Dict[str, Any]:
        return {"image_url": "mock_satellite.png", "date": "2023-10-01", "resolution": "10m"}

class OSMAdapter:
    """Adapter for OpenStreetMap (Overpass API) to fetch logistics/port infrastructure."""
    def get_infrastructure(self, lat: float, lng: float, radius_km: int = 10) -> List[Dict[str, Any]]:
        try:
            overpass_url = "http://overpass-api.de/api/interpreter"
            overpass_query = f"""
            [out:json];
            (
              node["industrial"="port"](around:{radius_km*1000},{lat},{lng});
              way["industrial"="port"](around:{radius_km*1000},{lat},{lng});
            );
            out center;
            """
            res = requests.get(overpass_url, params={'data': overpass_query}, timeout=15)
            if res.status_code == 200:
                return res.json().get('elements', [])
        except Exception as e:
            logger.error(f"OSM Overpass fetch error: {e}")
        return [{"type": "node", "tags": {"name": "Mock Port Facility"}, "lat": lat, "lon": lng}]

class UNComtradeAdapter:
    """Adapter for UN Comtrade data (trade flows)."""
    def get_trade_flow(self, reporter_code: str, partner_code: str, cmd_code: str) -> Dict[str, Any]:
        return {"export_value": 15000000, "import_value": 12000000, "commodity": cmd_code}

def ingest_entity_context(entity_data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Given basic entity data, fetches contextual intelligence from available open sources.
    """
    context = {}
    
    # Example: fetch news
    if 'company' in entity_data:
        gdelt = GDELTAdapter()
        context['news'] = gdelt.get_recent_events(entity_data['company'])
        
    # Example: fetch infrastructure if coords exist
    if 'lat' in entity_data and 'lng' in entity_data:
        osm = OSMAdapter()
        context['infrastructure'] = osm.get_infrastructure(entity_data['lat'], entity_data['lng'])
        
    return context
