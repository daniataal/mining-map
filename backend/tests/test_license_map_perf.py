"""Unit tests for license map LOD helpers."""

from backend.services.license_map_perf import (
    license_cluster_limit_for_zoom,
    license_grid_degrees,
    simplify_tolerance_for_zoom,
)


def test_license_grid_degrees_low_zoom():
    assert license_grid_degrees(2) == 12.0
    assert license_grid_degrees(3) == 8.0
    assert license_grid_degrees(5) == 4.0
    assert license_grid_degrees(7) == 1.5


def test_license_grid_degrees_detail_zoom():
    assert license_grid_degrees(8) is None
    assert license_grid_degrees(12) is None
    assert license_grid_degrees(None) is None


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
