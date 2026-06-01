"""Unit tests for license map LOD helpers."""

from backend.services.license_map_perf import (
    license_cluster_limit_for_zoom,
    license_cluster_min_count,
    license_grid_degrees,
    merge_license_clusters,
    simplify_tolerance_for_zoom,
)


def test_license_grid_degrees_low_zoom():
    assert license_grid_degrees(2) == 16.0
    assert license_grid_degrees(3) == 12.0
    assert license_grid_degrees(4) == 8.0
    assert license_grid_degrees(5) == 8.0
    assert license_grid_degrees(6) == 8.0
    assert license_grid_degrees(7) == 8.0


def test_license_grid_degrees_detail_zoom():
    assert license_grid_degrees(8) is None
    assert license_grid_degrees(8) is None
    assert license_grid_degrees(12) is None
    assert license_grid_degrees(None) is None


def test_license_cluster_min_count():
    assert license_cluster_min_count(1.5) == 2
    assert license_cluster_min_count(4.0) == 3
    assert license_cluster_min_count(12.0) == 4
    assert license_cluster_min_count(16.0) == 4


def test_merge_license_clusters_combines_neighbors():
    clusters = [
        {
            "id": "cluster:0:0",
            "lat": 0.0,
            "lng": 0.0,
            "mapClusterCount": 10,
            "country": "A",
            "sector": "mining",
        },
        {
            "id": "cluster:6:0",
            "lat": 6.0,
            "lng": 0.0,
            "mapClusterCount": 20,
            "country": "B",
            "sector": "mining",
        },
    ]
    merged = merge_license_clusters(clusters, grid_deg=6.0)
    assert len(merged) == 1
    assert merged[0]["mapClusterCount"] == 30


def test_cluster_limit_tighter_at_world_zoom():
    assert license_cluster_limit_for_zoom(2, 800) == 60
    assert license_cluster_limit_for_zoom(4, 800) == 120
    assert license_cluster_limit_for_zoom(10, 800) == 800


def test_simplify_tolerance_increases_when_zoomed_out():
    assert simplify_tolerance_for_zoom(12) == 0.0
    assert simplify_tolerance_for_zoom(10) == 0.0
    low = simplify_tolerance_for_zoom(4)
    mid = simplify_tolerance_for_zoom(7)
    assert low > mid > 0
