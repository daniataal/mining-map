"""Tests for the due-diligence evaluation engine.

Run from the repo root:
    python -m pytest backend/tests/test_due_diligence.py -v
"""

import sys
import os
import unittest
from unittest.mock import MagicMock, patch

# Allow both `python -m pytest` from repo root and direct `python test_...py` invocations.
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))


from schemas.due_diligence import DDRequest, DueDiligenceReport
from services.due_diligence import (
    evaluate_due_diligence,
    reload_rules,
    _check_sanctions,
    _check_corridor,
    _check_kyc,
    _check_commodity,
    _score_and_recommend,
)


RULES = {
    "_version": "test-1.0",
    "sanctioned_countries": ["Iran", "North Korea"],
    "high_risk_countries": ["Afghanistan", "South Sudan"],
    "embargoed_corridors": [
        {
            "id": "emb-russia-energy",
            "supplier_country": "Russia",
            "buyer_country": "*",
            "products": ["oil", "gas"],
            "reason": "Test embargo",
        }
    ],
    "commodity_rules": {
        "mining": {
            "conflict_minerals": ["coltan", "gold"],
            "conflict_mineral_high_risk_countries": ["Democratic Republic of Congo"],
            "certifications_advisory": ["EITI"],
            "required_license_statuses": ["active", "Active"],
        },
        "oil": {
            "certifications_advisory": ["API"],
            "required_license_statuses": ["active", "production"],
            "offshore_extra_check": True,
        },
        "gas": {
            "certifications_advisory": ["GIIGNL"],
            "required_license_statuses": ["active"],
            "pipeline_check": True,
        },
    },
    "kyc_thresholds": {
        "enhanced_kyc_above_usd": 1_000_000,
    },
    "scoring": {
        "fail_deduction": 35,
        "warn_deduction": 10,
        "approve_threshold": 80,
        "block_threshold": 50,
    },
}


# ---------------------------------------------------------------------------
# Sanctions checks
# ---------------------------------------------------------------------------

class TestSanctionsCheck(unittest.TestCase):
    def test_both_clean_countries_pass(self):
        req = DDRequest(supplier_country="Ghana", buyer_country="Netherlands", product_type="mining")
        results = _check_sanctions(req, RULES)
        self.assertEqual(len(results), 2)
        self.assertTrue(all(r.verdict == "pass" for r in results))

    def test_sanctioned_supplier_fails(self):
        req = DDRequest(supplier_country="Iran", buyer_country="Germany", product_type="oil")
        results = _check_sanctions(req, RULES)
        fail_results = [r for r in results if r.verdict == "fail"]
        self.assertEqual(len(fail_results), 1)
        self.assertIn("supplier", fail_results[0].check_id)

    def test_high_risk_buyer_warns(self):
        req = DDRequest(supplier_country="Canada", buyer_country="Afghanistan", product_type="mining")
        results = _check_sanctions(req, RULES)
        warn_results = [r for r in results if r.verdict == "warn"]
        self.assertEqual(len(warn_results), 1)
        self.assertIn("high_risk", warn_results[0].check_id)

    def test_both_sanctioned_two_fails(self):
        req = DDRequest(supplier_country="Iran", buyer_country="North Korea", product_type="mining")
        results = _check_sanctions(req, RULES)
        fails = [r for r in results if r.verdict == "fail"]
        self.assertEqual(len(fails), 2)


# ---------------------------------------------------------------------------
# Corridor checks
# ---------------------------------------------------------------------------

class TestCorridorCheck(unittest.TestCase):
    def test_embargoed_corridor_fails(self):
        req = DDRequest(supplier_country="Russia", buyer_country="Germany", product_type="oil")
        results = _check_corridor(req, RULES)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].verdict, "fail")
        self.assertIn("emb-russia-energy", results[0].check_id)

    def test_clear_corridor_passes(self):
        req = DDRequest(supplier_country="Norway", buyer_country="Germany", product_type="oil")
        results = _check_corridor(req, RULES)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].verdict, "pass")

    def test_embargoed_supplier_but_different_product_passes(self):
        req = DDRequest(supplier_country="Russia", buyer_country="Germany", product_type="mining")
        results = _check_corridor(req, RULES)
        self.assertEqual(results[0].verdict, "pass")


# ---------------------------------------------------------------------------
# KYC checks
# ---------------------------------------------------------------------------

class TestKYCCheck(unittest.TestCase):
    def test_missing_entity_names_warn(self):
        req = DDRequest(supplier_country="Ghana", buyer_country="UK", product_type="mining")
        results = _check_kyc(req, RULES)
        name_check = next(r for r in results if "name_missing" in r.check_id)
        self.assertEqual(name_check.verdict, "warn")

    def test_high_value_warns(self):
        req = DDRequest(
            supplier_country="Ghana",
            buyer_country="UK",
            product_type="mining",
            supplier_entity_name="Acme Mining Ltd",
            buyer_entity_name="TradeHouse GmbH",
            estimated_value_usd=2_000_000,
        )
        results = _check_kyc(req, RULES)
        high_val = next(r for r in results if "high_value" in r.check_id)
        self.assertEqual(high_val.verdict, "warn")

    def test_low_value_passes(self):
        req = DDRequest(
            supplier_country="Ghana",
            buyer_country="UK",
            product_type="mining",
            supplier_entity_name="Acme Mining Ltd",
            buyer_entity_name="TradeHouse GmbH",
            estimated_value_usd=100_000,
        )
        results = _check_kyc(req, RULES)
        val_check = next(r for r in results if "value_tier" in r.check_id)
        self.assertEqual(val_check.verdict, "pass")

    def test_no_value_warns(self):
        req = DDRequest(
            supplier_country="Ghana",
            buyer_country="UK",
            product_type="mining",
            supplier_entity_name="Acme",
            buyer_entity_name="Buyer",
        )
        results = _check_kyc(req, RULES)
        unknown = next(r for r in results if "value_unknown" in r.check_id)
        self.assertEqual(unknown.verdict, "warn")


# ---------------------------------------------------------------------------
# Commodity checks
# ---------------------------------------------------------------------------

class TestCommodityCheck(unittest.TestCase):
    def test_conflict_mineral_high_risk_origin_fails(self):
        req = DDRequest(
            supplier_country="Democratic Republic of Congo",
            buyer_country="Belgium",
            product_type="mining",
            commodity="coltan",
        )
        results = _check_commodity(req, RULES)
        fail_r = next(r for r in results if r.verdict == "fail")
        self.assertIn("conflict_mineral_high_risk", fail_r.check_id)

    def test_conflict_mineral_safe_origin_warns(self):
        req = DDRequest(
            supplier_country="Ghana",
            buyer_country="Germany",
            product_type="mining",
            commodity="gold",
        )
        results = _check_commodity(req, RULES)
        warn_r = next(r for r in results if r.verdict == "warn")
        self.assertIn("conflict_mineral", warn_r.check_id)

    def test_non_conflict_commodity_passes(self):
        req = DDRequest(
            supplier_country="Ghana",
            buyer_country="Germany",
            product_type="mining",
            commodity="bauxite",
        )
        results = _check_commodity(req, RULES)
        # Should pass on conflict mineral check
        conflict_results = [r for r in results if "conflict_mineral" in r.check_id]
        self.assertTrue(all(r.verdict == "pass" for r in conflict_results))

    def test_oil_offshore_warns(self):
        req = DDRequest(supplier_country="Nigeria", buyer_country="China", product_type="oil")
        results = _check_commodity(req, RULES)
        offshore = next((r for r in results if "offshore" in r.check_id), None)
        self.assertIsNotNone(offshore)
        self.assertEqual(offshore.verdict, "warn")

    def test_gas_pipeline_warns(self):
        req = DDRequest(supplier_country="Qatar", buyer_country="India", product_type="gas")
        results = _check_commodity(req, RULES)
        pipeline = next((r for r in results if "pipeline" in r.check_id), None)
        self.assertIsNotNone(pipeline)
        self.assertEqual(pipeline.verdict, "warn")


# ---------------------------------------------------------------------------
# Scoring and recommendation
# ---------------------------------------------------------------------------

class TestScoring(unittest.TestCase):
    def _make_check(self, verdict):
        from schemas.due_diligence import CheckResult
        return CheckResult(check_id="test.x", dimension="test", verdict=verdict, message="")

    def test_all_pass_approve(self):
        checks = [self._make_check("pass")] * 5
        score, blockers, rec = _score_and_recommend(checks, RULES)
        self.assertEqual(score, 100.0)
        self.assertEqual(rec, "approve")
        self.assertEqual(blockers, [])

    def test_one_fail_blocks(self):
        checks = [self._make_check("pass")] * 4 + [self._make_check("fail")]
        score, blockers, rec = _score_and_recommend(checks, RULES)
        self.assertEqual(rec, "block")
        self.assertEqual(len(blockers), 1)

    def test_multiple_warns_escalate(self):
        checks = [self._make_check("warn")] * 4
        score, blockers, rec = _score_and_recommend(checks, RULES)
        self.assertEqual(score, 60.0)
        self.assertEqual(rec, "escalate")

    def test_score_clamped_at_zero(self):
        checks = [self._make_check("fail")] * 10
        score, _, _ = _score_and_recommend(checks, RULES)
        self.assertEqual(score, 0.0)


# ---------------------------------------------------------------------------
# End-to-end evaluation
# ---------------------------------------------------------------------------

class TestEvaluateDueDiligence(unittest.TestCase):
    def test_clean_route_approved(self):
        req = DDRequest(
            supplier_country="Ghana",
            buyer_country="Netherlands",
            product_type="mining",
            commodity="bauxite",
            supplier_entity_name="Acme Mining Ltd",
            buyer_entity_name="TradeHouse BV",
            estimated_value_usd=200_000,
        )
        with patch("services.due_diligence._load_rules", return_value=RULES):
            reload_rules()
            report = evaluate_due_diligence(req, db_conn=None)

        self.assertEqual(type(report).__name__, "DueDiligenceReport")
        self.assertIn(report.recommendation, ("approve", "escalate"))
        self.assertEqual(report.supplier_country, "Ghana")
        self.assertIsNotNone(report.request_id)
        self.assertIsNotNone(report.evaluated_at)

    def test_sanctioned_supplier_blocks(self):
        req = DDRequest(
            supplier_country="Iran",
            buyer_country="Germany",
            product_type="oil",
        )
        with patch("services.due_diligence._load_rules", return_value=RULES):
            reload_rules()
            report = evaluate_due_diligence(req, db_conn=None)

        self.assertEqual(report.recommendation, "block")
        self.assertTrue(len(report.blockers) >= 1)

    def test_embargoed_corridor_blocks(self):
        req = DDRequest(
            supplier_country="Russia",
            buyer_country="France",
            product_type="gas",
        )
        with patch("services.due_diligence._load_rules", return_value=RULES):
            reload_rules()
            report = evaluate_due_diligence(req, db_conn=None)

        self.assertEqual(report.recommendation, "block")

    def test_no_db_conn_license_warn(self):
        req = DDRequest(supplier_country="Ghana", buyer_country="UK", product_type="mining")
        with patch("services.due_diligence._load_rules", return_value=RULES):
            reload_rules()
            report = evaluate_due_diligence(req, db_conn=None)

        license_checks = [c for c in report.checks if c.dimension == "license"]
        self.assertTrue(any(c.verdict == "warn" for c in license_checks))

    def test_license_ids_validated_via_mock_db(self):
        req = DDRequest(
            supplier_country="Ghana",
            buyer_country="UK",
            product_type="mining",
            license_ids=["lic-001", "lic-missing"],
        )

        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_conn.cursor.return_value.__enter__ = MagicMock(return_value=mock_cursor)
        mock_conn.cursor.return_value.__exit__ = MagicMock(return_value=False)

        def fetchone_side_effect():
            # First call: lic-001 found and active; second: lic-missing not found
            calls = mock_cursor.fetchone.call_count
            if calls == 1:
                return {
                    "id": "lic-001",
                    "company": "Acme Mining",
                    "country": "Ghana",
                    "commodity": "gold",
                    "license_type": "mining",
                    "status": "active",
                }
            return None

        mock_cursor.fetchone.side_effect = fetchone_side_effect

        with patch("services.due_diligence._load_rules", return_value=RULES):
            reload_rules()
            report = evaluate_due_diligence(req, db_conn=mock_conn)

        license_checks = [c for c in report.checks if c.dimension == "license"]
        verdicts = {c.check_id: c.verdict for c in license_checks}

        # lic-001 should pass; lic-missing should fail
        self.assertTrue(any("not_found" in cid for cid in verdicts))

    def test_report_fields_complete(self):
        req = DDRequest(supplier_country="Nigeria", buyer_country="China", product_type="oil")
        with patch("services.due_diligence._load_rules", return_value=RULES):
            reload_rules()
            report = evaluate_due_diligence(req, db_conn=None)

        self.assertIsNotNone(report.request_id)
        self.assertIsNotNone(report.evaluated_at)
        self.assertIsInstance(report.checks, list)
        self.assertGreater(len(report.checks), 0)
        self.assertGreaterEqual(report.overall_score, 0)
        self.assertLessEqual(report.overall_score, 100)
        self.assertIn(report.recommendation, ("approve", "escalate", "block"))


if __name__ == "__main__":
    unittest.main()
