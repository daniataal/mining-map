import requests
import logging
import time
from typing import Dict, Any, List, Optional, Tuple
import json

logger = logging.getLogger(__name__)

class ArcGISCadastreAdapter:
    """
    Robust adapter for scraping mining cadastres from ArcGIS REST Services
    (e.g., Trimble Landfolio portals used by many African nations).
    """
    def __init__(self, base_url: str, layer_id: int = 0):
        self.base_url = base_url.rstrip('/')
        self.layer_url = f"{self.base_url}/{layer_id}"
        self.session = requests.Session()
        # Setup basic retry adapter for flaky government servers
        adapter = requests.adapters.HTTPAdapter(max_retries=3)
        self.session.mount('http://', adapter)
        self.session.mount('https://', adapter)

    def fetch_all_licenses(self, batch_size: int = 1000) -> List[Dict[str, Any]]:
        """
        Paginates through the ArcGIS layer and fetches all features.
        """
        all_features = []
        offset = 0
        has_more = True

        logger.info(f"Starting ArcGIS fetch from {self.layer_url}")

        while has_more:
            params = {
                'where': '1=1',
                'outFields': '*',
                'f': 'geojson',
                'resultOffset': offset,
                'resultRecordCount': batch_size,
                'returnGeometry': 'true',
                'spatialRel': 'esriSpatialRelIntersects'
            }
            
            try:
                response = self.session.get(f"{self.layer_url}/query", params=params, timeout=30)
                response.raise_for_status()
                data = response.json()

                features = data.get('features', [])
                if not features:
                    break
                
                all_features.extend(features)
                
                # Check if we've hit the limit
                if data.get('exceededTransferLimit'):
                    offset += batch_size
                    time.sleep(1) # Be polite to the server
                else:
                    has_more = False

            except Exception as e:
                logger.error(f"Error fetching batch at offset {offset}: {e}")
                break

        logger.info(f"Fetched {len(all_features)} total features.")
        return all_features

    def calculate_centroid(self, geometry: Dict[str, Any]) -> Tuple[Optional[float], Optional[float]]:
        """
        Calculates a rough centroid from a GeoJSON geometry.
        Works for Point, Polygon, and MultiPolygon.
        """
        if not geometry:
            return None, None
            
        geom_type = geometry.get('type')
        coords = geometry.get('coordinates')
        
        if not coords:
            return None, None

        def get_poly_centroid(ring):
            if not ring: return None, None
            lats = [pt[1] for pt in ring]
            lngs = [pt[0] for pt in ring]
            return sum(lats)/len(lats), sum(lngs)/len(lngs)

        try:
            if geom_type == 'Point':
                return coords[1], coords[0]
            elif geom_type == 'Polygon':
                # Use the exterior ring (index 0)
                return get_poly_centroid(coords[0])
            elif geom_type == 'MultiPolygon':
                # Use the exterior ring of the first polygon
                return get_poly_centroid(coords[0][0])
        except Exception as e:
            logger.warning(f"Failed to calculate centroid for {geom_type}: {e}")
            
        return None, None

    def map_to_standard_schema(self, feature: Dict[str, Any], field_map: Dict[str, str]) -> Dict[str, Any]:
        """
        Maps a raw ArcGIS feature to the standard MiningLicense/Entity schema.
        `field_map` should be a dict mapping standard keys to ArcGIS property keys.
        Example: {'company': 'COMP_NAME', 'status': 'LIC_STATUS'}
        """
        props = feature.get('properties', {})
        geom = feature.get('geometry')
        
        lat, lng = self.calculate_centroid(geom)
        
        mapped = {
            'id': props.get(field_map.get('id', 'OBJECTID')),
            'company': props.get(field_map.get('company', 'COMPANY')),
            'licenseType': props.get(field_map.get('licenseType', 'TYPE')),
            'commodity': props.get(field_map.get('commodity', 'COMMODITY')),
            'status': props.get(field_map.get('status', 'STATUS')),
            'lat': lat,
            'lng': lng,
            'raw_properties': props # Keep original for raw evidence
        }
        
        # Ensure ID is a string
        if mapped['id'] is not None:
            mapped['id'] = str(mapped['id'])
            
        return mapped

# Simple CLI test runner for dry-runs
if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)
    
    # Example test with a generic/demo spatial server if URL is provided
    if len(sys.argv) > 1:
        test_url = sys.argv[1]
        adapter = ArcGISCadastreAdapter(test_url)
        features = adapter.fetch_all_licenses(batch_size=50) # Small batch for testing
        
        if features:
            print(f"Successfully grabbed {len(features)} features.")
            sample = features[0]
            print("Sample feature properties:")
            print(json.dumps(sample.get('properties', {}), indent=2))
            
            # Test centroid calc
            lat, lng = adapter.calculate_centroid(sample.get('geometry'))
            print(f"Calculated Centroid: {lat}, {lng}")
    else:
        print("Provide an ArcGIS layer URL to test (e.g., python arcgis_adapter.py https://example.com/arcgis/rest/services/MapServer/0)")
