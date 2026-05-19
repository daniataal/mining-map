"""Printable HTML export for deal room decision packages (no PDF library required)."""

from __future__ import annotations

import html
import json
from typing import Any


def _esc(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return html.escape(json.dumps(value, indent=2, default=str)[:4000])
    return html.escape(str(value))


def render_deal_room_export_html(package: dict[str, Any]) -> str:
    room = package.get("dealRoom") or {}
    entity = package.get("entity") or {}
    route = package.get("routeSummary") or {}
    usa = package.get("relatedUsaAwards") or []
    eu = package.get("relatedEuNotices") or []
    risks = package.get("risks") or []

    usa_rows = "".join(
        f"<tr><td>{_esc(a.get('award_id') or a.get('id'))}</td>"
        f"<td>{_esc(a.get('recipient_name') or a.get('company'))}</td>"
        f"<td>{_esc(a.get('award_amount') or a.get('total_obligation'))}</td></tr>"
        for a in usa[:15]
        if isinstance(a, dict)
    )
    eu_rows = "".join(
        f"<tr><td>{_esc(n.get('notice_id'))}</td><td>{_esc(n.get('title'))}</td>"
        f"<td>{_esc(n.get('buyer_name') or n.get('country'))}</td></tr>"
        for n in eu[:15]
        if isinstance(n, dict)
    )
    risk_items = "".join(f"<li>{_esc(r)}</li>" for r in risks[:20])

    title = _esc(room.get("title") or entity.get("company") or "Deal Room Export")
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>{title}</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 2rem; color: #0f172a; }}
    h1 {{ font-size: 1.5rem; }}
    h2 {{ font-size: 1.1rem; margin-top: 1.5rem; border-bottom: 1px solid #e2e8f0; }}
    table {{ border-collapse: collapse; width: 100%; margin-top: 0.5rem; font-size: 0.85rem; }}
    th, td {{ border: 1px solid #cbd5e1; padding: 0.35rem 0.5rem; text-align: left; }}
    th {{ background: #f1f5f9; }}
    .meta {{ color: #64748b; font-size: 0.85rem; }}
    @media print {{ body {{ margin: 1cm; }} }}
  </style>
</head>
<body>
  <h1>{title}</h1>
  <p class="meta">Exported {_esc(package.get("exportedAt"))} · Decision: <strong>{_esc(package.get("decision"))}</strong>
     · Confidence: {_esc(package.get("confidence"))}</p>
  <h2>Entity</h2>
  <p>{_esc(entity.get("company"))} — {_esc(entity.get("country"))} · {_esc(entity.get("commodity"))}</p>
  <h2>Route</h2>
  <p>Status: {_esc(route.get("status"))} · Source: {_esc(route.get("source"))} ·
     Total USD: {_esc(route.get("totalCostUsd"))}</p>
  <h2>Procurement enrichment (Phase 7)</h2>
  <p>Related USAspending awards (fuzzy): {len(usa)} · Related EU TED notices (fuzzy): {len(eu)}</p>
  <h3>USAspending</h3>
  <table><thead><tr><th>Award ID</th><th>Recipient</th><th>Amount</th></tr></thead>
  <tbody>{usa_rows or '<tr><td colspan="3">None matched</td></tr>'}</tbody></table>
  <h3>EU TED</h3>
  <table><thead><tr><th>Notice</th><th>Title</th><th>Buyer / Country</th></tr></thead>
  <tbody>{eu_rows or '<tr><td colspan="3">None matched</td></tr>'}</tbody></table>
  <h2>Risks</h2>
  <ul>{risk_items or '<li>None recorded</li>'}</ul>
  <h2>Markdown summary</h2>
  <pre>{_esc(package.get("markdown") or "")}</pre>
</body>
</html>"""
