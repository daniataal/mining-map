from backend.services.agent_intelligence import (
    deterministic_entity_warnings,
    deterministic_route_warnings,
    stable_input_hash,
)
from backend.services.entity_contacts import build_license_contact_candidates


def test_stable_input_hash_is_order_independent():
    first = {"entity": {"id": "lic-1", "company": "Acme"}, "warnings": ["a", "b"]}
    second = {"warnings": ["a", "b"], "entity": {"company": "Acme", "id": "lic-1"}}

    assert stable_input_hash(first) == stable_input_hash(second)


def test_route_validator_flags_simulation_sparse_sea_and_long_road():
    warnings = deterministic_route_warnings(
        {
            "source": "simulation",
            "liveUnavailableReason": "backend offline",
            "route": {
                "origin": {"name": "Mine", "lat": -12.0, "lng": 28.0, "metadata": {"country": "Zambia"}},
                "destination": {"name": "Buyer", "lat": 51.9, "lng": 4.4, "metadata": {"country": "Netherlands"}},
                "legs": [
                    {
                        "method": "road",
                        "distance_km": 1800,
                        "from": {"name": "Mine", "lat": -12.0, "lng": 28.0, "metadata": {"country": "Zambia"}},
                        "to": {"name": "Foreign Port", "lat": -6.8, "lng": 39.2, "metadata": {"country": "Tanzania"}},
                        "path": [[-12.0, 28.0], [-6.8, 39.2]],
                    },
                    {
                        "method": "sea",
                        "geometry_source": "straight_line",
                        "from": {"name": "Warehouse", "lat": -6.8, "lng": 39.2, "kind": "warehouse"},
                        "to": {"name": "Rotterdam", "lat": 51.9, "lng": 4.4, "kind": "port"},
                        "path": [[-6.8, 39.2], [51.9, 4.4]],
                    },
                ],
            },
        }
    )

    codes = {warning["code"] for warning in warnings}
    assert "route.simulation" in codes
    assert "route.road_leg_very_long" in codes
    assert "route.road_cross_country" in codes
    assert "route.sea_endpoint_not_port" in codes
    assert "route.sea_geometry_degraded" in codes


def test_entity_validator_flags_missing_core_fields():
    warnings = deterministic_entity_warnings(
        {
            "id": "lic-1",
            "company": "",
            "country": "",
            "lat": 0,
            "lng": 0,
            "record_origin": "open_data",
        },
        relationships=[],
    )

    codes = {warning["code"] for warning in warnings}
    assert "entity.missing_coords" in codes
    assert "entity.missing_company" in codes
    assert "entity.missing_country" in codes
    assert "entity.missing_operator" in codes
    assert "entity.source_missing" in codes


def test_contact_extraction_does_not_hallucinate_missing_contacts():
    contacts = build_license_contact_candidates(
        {
            "id": "lic-1",
            "company": "Acme Mining",
            "record_origin": "open_data",
            "source_name": "Official registry",
            "source_url": "https://registry.example/record/lic-1",
            "raw_payload": {"operator": "Acme Mining"},
        }
    )

    assert contacts == []
