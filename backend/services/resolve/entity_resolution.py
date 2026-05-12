import logging
from typing import List, Dict, Any, Tuple
import math

logger = logging.getLogger(__name__)

def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great circle distance in kilometers between two points on the earth."""
    R = 6371  # Radius of the earth in km
    dLat = math.radians(lat2 - lat1)
    dLon = math.radians(lon2 - lon1)
    a = (math.sin(dLat / 2) * math.sin(dLat / 2) +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dLon / 2) * math.sin(dLon / 2))
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return R * c

def jaro_winkler(s1: str, s2: str) -> float:
    """
    Simplified Jaro-Winkler distance for string similarity.
    Returns a score between 0.0 and 1.0.
    In a production system, use the `jellyfish` or `textdistance` libraries.
    """
    if not s1 or not s2:
        return 0.0
    s1, s2 = s1.lower(), s2.lower()
    if s1 == s2:
        return 1.0
    
    # Very basic approximation for the sake of the structural adapter
    # Fallback to Jaccard similarity on bigrams
    b1 = set(s1[i:i+2] for i in range(len(s1)-1))
    b2 = set(s2[i:i+2] for i in range(len(s2)-1))
    if not b1 or not b2:
        return 0.0
    return len(b1.intersection(b2)) / len(b1.union(b2))

class EntityResolutionEngine:
    """
    Handles entity matching and deduplication across datasets.
    """
    def __init__(self, db_connection=None):
        self.db = db_connection

    def find_matches(self, incoming_entity: Dict[str, Any], existing_entities: List[Dict[str, Any]], 
                     name_threshold: float = 0.8, dist_threshold_km: float = 50.0) -> List[Tuple[Dict[str, Any], float]]:
        """
        Finds matching entities in the existing dataset.
        Returns a list of tuples (matched_entity, confidence_score).
        """
        matches = []
        inc_name = incoming_entity.get('name') or incoming_entity.get('company', '')
        inc_lat = incoming_entity.get('lat')
        inc_lng = incoming_entity.get('lng')

        for ext in existing_entities:
            ext_name = ext.get('name') or ext.get('company', '')
            name_sim = jaro_winkler(inc_name, ext_name)
            
            geo_sim = 1.0
            if inc_lat is not None and inc_lng is not None and 'lat' in ext and 'lng' in ext:
                ext_lat, ext_lng = ext['lat'], ext['lng']
                if ext_lat is not None and ext_lng is not None:
                    dist = haversine_distance(inc_lat, inc_lng, ext_lat, ext_lng)
                    if dist > dist_threshold_km:
                        geo_sim = 0.0 # Too far
                    else:
                        geo_sim = 1.0 - (dist / dist_threshold_km)

            # Combined confidence score
            confidence = (name_sim * 0.7) + (geo_sim * 0.3)
            
            if name_sim >= name_threshold and geo_sim > 0:
                matches.append((ext, confidence))
                
        # Sort by highest confidence
        matches.sort(key=lambda x: x[1], reverse=True)
        return matches

    def merge_entities(self, primary: Dict[str, Any], secondary: Dict[str, Any]) -> Dict[str, Any]:
        """
        Merges two entities, prioritizing fields from the primary entity.
        """
        merged = secondary.copy()
        for k, v in primary.items():
            if v is not None and v != "":
                merged[k] = v
        
        # Keep track of aliases
        aliases = merged.get('aliases', [])
        sec_name = secondary.get('name') or secondary.get('company')
        if sec_name and sec_name not in aliases and sec_name != (primary.get('name') or primary.get('company')):
            aliases.append(sec_name)
        merged['aliases'] = aliases
        
        return merged
