"""Tests for bunker fuel supplier seed + enrichment helpers."""

from pathlib import Path
from unittest import TestCase

from backend.services.bunker_fuel_suppliers_seed import iter_supplier_records, load_bunker_fuel_suppliers
from backend.services.supplier_enrichment import sync_bunker_fuel_suppliers_to_companies


class BunkerFuelSuppliersSeedTests(TestCase):
    def test_seed_loads_hubs(self):
        payload = load_bunker_fuel_suppliers()
        self.assertIn("hubs", payload)
        self.assertGreaterEqual(len(payload.get("hubs") or []), 1)

    def test_iter_supplier_records_skips_placeholders(self):
        records = iter_supplier_records()
        names = [r["company_name"] for r in records]
        self.assertIn("Al Arabia Bunkering", names)
        self.assertIn("Akron Trade and Transport", names)
        self.assertIn("Vitol Bunkers (S) Pte. Ltd.", names)
        self.assertGreaterEqual(len(records), 240)
        self.assertFalse(any("port register" in n.lower() for n in names))
        with_phone = [r for r in records if r.get("phone")]
        self.assertGreaterEqual(len(with_phone), 160)
        sg = [r for r in records if r.get("locode") == "SGSIN"]
        self.assertEqual(len(sg), 39)
        with_address = [r for r in sg if r.get("address")]
        self.assertEqual(len(with_address), 39)
        bp = next(r for r in sg if r["company_name"].startswith("BP Singapore"))
        self.assertEqual(bp.get("fuels_supplied"), "MDO/ MGO /MFO")
        self.assertIn("Marina One", bp.get("address") or "")
        self.assertIn("Masaki Low", bp.get("contact_person") or "")
        fj = [r for r in records if r.get("locode") == "AEFJR"]
        self.assertGreaterEqual(len(fj), 13)
        akron = next(r for r in fj if "Akron" in r["company_name"])
        self.assertEqual(akron.get("fuels_supplied"), "Compliant marine fuels (Port licensed)")
        uk = [r for r in records if r.get("locode") == "GB"]
        self.assertEqual(len(uk), 53)
        with_address = [r for r in uk if r.get("address")]
        self.assertEqual(len(with_address), 53)
        valero = next(r for r in uk if "Valero" in r["company_name"])
        self.assertIn("Canada Square", valero.get("address") or "")
        self.assertEqual(valero.get("phone"), "02075 133867")
        self.assertFalse(valero.get("email"))
        nl = [r for r in records if r.get("locode") == "NLRTM"]
        self.assertEqual(len(nl), 35)
        shell = next(r for r in nl if "Shell Trading Rotterdam" in r["company_name"])
        self.assertFalse(shell.get("phone"))
        self.assertFalse(shell.get("email"))
        self.assertFalse(shell.get("address"))
        self.assertEqual(
            shell.get("fuels_supplied"),
            "ILT-registered marine fuel oil supplier (Netherlands)",
        )
        nz = [r for r in records if r.get("locode") == "NZ"]
        self.assertEqual(len(nz), 62)
        self.assertEqual(len([r for r in nz if r.get("phone")]), 62)
        self.assertFalse(any(r.get("email") or r.get("address") for r in nz))
        allied = next(r for r in nz if "Allied Petroleum" in r["company_name"])
        self.assertEqual(allied.get("phone"), "0800 383 566")
        self.assertIn("Port: Auckland", allied.get("notes") or "")
        beanr = [r for r in records if r.get("locode") == "BEANR"]
        self.assertEqual(len(beanr), 37)
        self.assertEqual(len([r for r in beanr if r.get("address")]), 37)
        self.assertEqual(len([r for r in beanr if r.get("email")]), 30)
        self.assertFalse(any(r.get("phone") for r in beanr))
        peninsula = next(r for r in beanr if "Peninsula Petroleum" in r["company_name"])
        self.assertIn("Noorderplaats", peninsula.get("address") or "")
        self.assertEqual(peninsula.get("email"), "antwerpops@peninsula360.com")


class BunkerFuelSuppliersSyncTests(TestCase):
    def test_sync_module_importable(self):
        self.assertTrue(callable(sync_bunker_fuel_suppliers_to_companies))

    def test_go_trigger_helper_importable(self):
        from backend.services.supplier_enrichment import trigger_go_bunker_fuel_suppliers_sync

        self.assertTrue(callable(trigger_go_bunker_fuel_suppliers_sync))
