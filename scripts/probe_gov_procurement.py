#!/usr/bin/env python3
"""Probe USAspending federal awards for a company name (no API key required).

Usage:
  python scripts/probe_gov_procurement.py "Newmont Corporation"
  python scripts/probe_gov_procurement.py "Barrick Gold"
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.services.gov_procurement_intel import collect_gov_procurement, serialize_gov_procurement_response


def main() -> int:
    company = " ".join(sys.argv[1:]).strip() or "Newmont Corporation"
    payload = collect_gov_procurement(company_name=company, country="United States")
    print(json.dumps(serialize_gov_procurement_response(payload), indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
