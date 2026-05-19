"""True PDF export for deal room packages (reportlab with HTML fallback)."""

from __future__ import annotations

from typing import Any, Optional

try:
    from backend.services.deal_room_export_html import render_deal_room_export_html
except ImportError:
    from services.deal_room_export_html import render_deal_room_export_html  # type: ignore[no-redef]


def render_deal_room_export_pdf(package: dict[str, Any]) -> tuple[bytes, str]:
    """
    Return (body_bytes, media_type).
    Uses reportlab when installed; otherwise returns printable HTML bytes.
    """
    try:
        return _render_reportlab_pdf(package), "application/pdf"
    except ImportError:
        html_body = render_deal_room_export_html(package)
        return html_body.encode("utf-8"), "text/html; charset=utf-8"


def _render_reportlab_pdf(package: dict[str, Any]) -> bytes:
    from io import BytesIO

    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    from reportlab.lib import colors

    room = package.get("dealRoom") or {}
    entity = package.get("entity") or {}
    route = package.get("routeSummary") or {}
    usa = package.get("relatedUsaAwards") or []
    eu = package.get("relatedEuNotices") or []
    risks = package.get("risks") or []

    buffer = BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, title=str(room.get("title") or "Deal Room"))
    styles = getSampleStyleSheet()
    story: list[Any] = []

    title = str(room.get("title") or entity.get("company") or "Deal Room Export")
    story.append(Paragraph(title, styles["Title"]))
    story.append(
        Paragraph(
            f"Exported {package.get('exportedAt', '')} · Decision: <b>{package.get('decision', '')}</b>",
            styles["Normal"],
        )
    )
    story.append(Spacer(1, 12))
    story.append(Paragraph("Entity", styles["Heading2"]))
    story.append(
        Paragraph(
            f"{entity.get('company', '')} — {entity.get('country', '')} · {entity.get('commodity', '')}",
            styles["Normal"],
        )
    )
    story.append(Paragraph("Route", styles["Heading2"]))
    story.append(
        Paragraph(
            f"Status: {route.get('status', '')} · Total USD: {route.get('totalCostUsd', '')}",
            styles["Normal"],
        )
    )

    if usa:
        story.append(Paragraph("USAspending (sample)", styles["Heading3"]))
        usa_data = [["Award ID", "Recipient", "Amount"]]
        for row in usa[:12]:
            if isinstance(row, dict):
                usa_data.append(
                    [
                        str(row.get("award_id") or row.get("id") or ""),
                        str(row.get("recipient_name") or row.get("company") or ""),
                        str(row.get("award_amount") or row.get("total_obligation") or ""),
                    ]
                )
        tbl = Table(usa_data, colWidths=[120, 200, 80])
        tbl.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                ]
            )
        )
        story.append(tbl)

    if eu:
        story.append(Spacer(1, 8))
        story.append(Paragraph("EU TED (sample)", styles["Heading3"]))
        eu_data = [["Notice", "Title", "Buyer"]]
        for row in eu[:12]:
            if isinstance(row, dict):
                eu_data.append(
                    [
                        str(row.get("notice_id") or ""),
                        str(row.get("title") or "")[:60],
                        str(row.get("buyer_name") or row.get("country") or ""),
                    ]
                )
        tbl2 = Table(eu_data, colWidths=[80, 200, 120])
        tbl2.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f5f9")),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                ]
            )
        )
        story.append(tbl2)

    if risks:
        story.append(Spacer(1, 8))
        story.append(Paragraph("Risks", styles["Heading2"]))
        for risk in risks[:15]:
            story.append(Paragraph(f"• {risk}", styles["Normal"]))

    doc.build(story)
    return buffer.getvalue()


def pdf_export_available() -> bool:
    try:
        import reportlab  # noqa: F401

        return True
    except ImportError:
        return False
