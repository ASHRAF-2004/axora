#!/usr/bin/env python3
"""Render the secret-free runbooks and an explicitly supplied genuine screenshot.

Reads only the two fixed source documents and supplied local PNG. Never connects
to a service, reads runtime configuration, runs migration commands or inspects
credentials. Dependencies: reportlab and Pillow (private task venv is sufficient).
"""

from __future__ import annotations

import argparse
import hashlib
import html
from pathlib import Path
import re

from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    Flowable, Image, KeepTogether, PageBreak, Paragraph, SimpleDocTemplate,
    Spacer, Table, TableStyle, XPreformatted,
)

NAVY = colors.HexColor("#0b3157")
BLUE = colors.HexColor("#286a99")
MUTED = colors.HexColor("#506174")
LIGHT = colors.HexColor("#f1f5f9")
GOLD = colors.HexColor("#eaa63a")
WIDTH = A4[0] - 36 * mm
SCREENSHOT_SHA256 = "1d6ecebc9a1944780bfb85f5859d81cd172248980f13e72ec1b53b37ef45d4d5"


class ConceptDiagram(Flowable):
    def __init__(self, recovery: bool = False):
        super().__init__()
        self.width = WIDTH
        self.height = 73 if recovery else 96
        self.recovery = recovery

    def draw(self):
        canvas = self.canv
        canvas.setFont("Helvetica-Bold", 9)
        canvas.setFillColor(MUTED)
        canvas.drawString(0, self.height - 11, "CONCEPTUAL DIAGRAM - not a completed operation")
        labels = (["Storage + Docker", "PostgreSQL", "App + workers", "Caddy + Tunnel"]
                  if self.recovery else ["Old writer", "Private restore", "Final freeze", "One new writer"])
        box_width = (WIDTH - 36) / 4
        y = self.height - 53
        for index, label in enumerate(labels):
            x = index * (box_width + 12)
            canvas.setFillColor(NAVY if index in (0, 3) else LIGHT)
            canvas.setStrokeColor(BLUE)
            canvas.roundRect(x, y, box_width, 28, 4, fill=1, stroke=0)
            canvas.setFillColor(colors.white if index in (0, 3) else NAVY)
            canvas.setFont("Helvetica-Bold", 8)
            canvas.drawCentredString(x + box_width / 2, y + 10, label)
            if index < 3:
                canvas.setStrokeColor(BLUE)
                canvas.line(x + box_width + 2, y + 14, x + box_width + 10, y + 14)
                canvas.line(x + box_width + 7, y + 17, x + box_width + 10, y + 14)
                canvas.line(x + box_width + 7, y + 11, x + box_width + 10, y + 14)
        if not self.recovery:
            canvas.setFillColor(MUTED)
            canvas.setFont("Helvetica", 8)
            canvas.drawString(0, y - 17, "No ingress / no real sends until validation; fence old writer before cutover.")
            canvas.drawString(0, y - 30, "New writes accepted? Never switch back to stale old data.")


def inline(value: str) -> str:
    value = html.escape(value)
    value = re.sub(r"`([^`]+)`", r'<font name="Courier">\1</font>', value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"\[([^]]+)\]\((https://[^)]+)\)",
                   r'<a href="\2" color="#286a99">\1</a> <font size="7">(\2)</font>', value)
    return value


def render_markdown(text: str, styles, screenshot: Path):
    story = []
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            index += 1
            continue
        if line == "<!-- pdf-page -->":
            story.append(PageBreak())
            index += 1
            continue
        if line == "<!-- conceptual-migration-diagram -->":
            story.append(ConceptDiagram())
            index += 1
            continue
        if line == "<!-- conceptual-recovery-diagram -->":
            story.append(ConceptDiagram(recovery=True))
            index += 1
            continue
        if line == "<!-- genuine-public-health-screenshot -->":
            with PILImage.open(screenshot) as picture:
                image_width, image_height = picture.size
            figure = Image(str(screenshot), width=WIDTH,
                           height=WIDTH * image_height / image_width)
            story.append(KeepTogether([
                Paragraph("Genuine browser capture - production readiness only", styles["h3"]),
                figure, Spacer(1, 5 * mm),
                Paragraph("1. Ready JSON, not migration, delivery or whole-host boot evidence.", styles["caption"]),
            ]))
            index += 1
            continue
        if line.startswith("```"):
            code = []
            index += 1
            while index < len(lines) and not lines[index].startswith("```"):
                code.append(lines[index])
                index += 1
            story.append(XPreformatted(html.escape("\n".join(code)), styles["code"]))
            story.append(Spacer(1, 2 * mm))
            index += 1
            continue
        if line.startswith("|"):
            table_lines = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                row = [cell.strip() for cell in lines[index].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-+:?", cell) for cell in row):
                    table_lines.append(row)
                index += 1
            data = [[Paragraph(inline(cell), styles["cell"]) for cell in row] for row in table_lines]
            columns = len(data[0])
            widths = [WIDTH * .30, WIDTH * .70] if columns == 2 else [WIDTH / columns] * columns
            table = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
            table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), LIGHT),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LEFTPADDING", (0, 0), (-1, -1), 7),
                ("RIGHTPADDING", (0, 0), (-1, -1), 7),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LINEBELOW", (0, 0), (-1, -1), .35, colors.HexColor("#d7e0e8")),
            ]))
            story.extend([table, Spacer(1, 3 * mm)])
            continue
        if line.startswith("# "):
            story.append(Paragraph(inline(line[2:]), styles["title"]))
            index += 1
            continue
        if line.startswith("## ") or line.startswith("### "):
            depth = 3 if line.startswith("### ") else 2
            story.append(Paragraph(inline(line[depth + 1:]), styles[f"h{depth}"]))
            index += 1
            continue
        list_item = line.startswith("- ") or bool(re.match(r"\d+\. ", line))
        paragraph = [line]
        index += 1
        while index < len(lines) and lines[index].strip() and not re.match(
            r"(?:#|\||```|<!--|- |\d+\. )", lines[index].strip()
        ):
            paragraph.append(lines[index].strip())
            index += 1
        story.append(Paragraph(inline(" ".join(paragraph)), styles["list" if list_item else "body"]))
    return story


def footer(canvas, document):
    canvas.saveState()
    canvas.setStrokeColor(GOLD)
    canvas.setLineWidth(1)
    canvas.line(18 * mm, 17 * mm, A4[0] - 18 * mm, 17 * mm)
    canvas.setFont("Helvetica", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(18 * mm, 12 * mm, "AXORA | Future migration only | Host reboot prohibited in this pass | 2026-10-08")
    canvas.drawRightString(A4[0] - 18 * mm, 12 * mm, str(document.page))
    canvas.restoreState()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--screenshot", type=Path, required=True)
    args = parser.parse_args()
    if args.screenshot.is_symlink() or not args.screenshot.is_file():
        parser.error("Provide the genuine local PNG file, not a symlink or remote URL.")
    if hashlib.sha256(args.screenshot.read_bytes()).hexdigest() != SCREENSHOT_SHA256:
        parser.error("Screenshot does not match the reviewed genuine public-health capture.")
    with PILImage.open(args.screenshot) as image:
        if image.format != "PNG" or image.size != (1000, 220):
            parser.error("Expected the reviewed compact genuine 1000x220 PNG capture.")
    repository = Path(__file__).resolve().parents[2]
    sources = [repository / "docs/operations/SERVER_MIGRATION.md",
               repository / "docs/operations/REBOOT_RECOVERY.md"]
    if args.output.exists():
        parser.error("Output exists; use a new reviewed temporary output path.")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    base = getSampleStyleSheet()
    styles = {
        "title": ParagraphStyle("GuideTitle", parent=base["Title"], fontName="Helvetica-Bold",
                                fontSize=23, leading=27, textColor=NAVY, alignment=0, spaceAfter=12),
        "h2": ParagraphStyle("GuideH2", fontName="Helvetica-Bold", fontSize=16, leading=20,
                             textColor=NAVY, spaceBefore=8, spaceAfter=9, keepWithNext=True),
        "h3": ParagraphStyle("GuideH3", fontName="Helvetica-Bold", fontSize=11, leading=15,
                             textColor=BLUE, spaceBefore=8, spaceAfter=6, keepWithNext=True),
        "body": ParagraphStyle("GuideBody", fontName="Helvetica", fontSize=9.1, leading=13.1,
                               textColor=NAVY, spaceAfter=7, splitLongWords=True),
        "list": ParagraphStyle("GuideList", fontName="Helvetica", fontSize=9.1, leading=13.1,
                               textColor=NAVY, leftIndent=7, spaceAfter=6, splitLongWords=True),
        "cell": ParagraphStyle("GuideCell", fontName="Helvetica", fontSize=8.4, leading=11.6,
                               textColor=NAVY, splitLongWords=True),
        "code": ParagraphStyle("GuideCode", fontName="Courier", fontSize=7.4, leading=10.2,
                               textColor=NAVY, backColor=LIGHT, borderPadding=8, spaceAfter=7),
        "caption": ParagraphStyle("GuideCaption", fontName="Helvetica", fontSize=8.2, leading=11.5,
                                  textColor=MUTED, alignment=TA_CENTER, spaceAfter=8),
    }
    story = []
    for index, source in enumerate(sources):
        if index:
            story.append(PageBreak())
        story.extend(render_markdown(source.read_text(encoding="utf-8"), styles, args.screenshot))
    document = SimpleDocTemplate(str(args.output), pagesize=A4, rightMargin=18 * mm,
                                 leftMargin=18 * mm, topMargin=16 * mm, bottomMargin=23 * mm,
                                 title="Axora Server Migration Guide", author="Axora",
                                 subject="Secret-free future migration and service recovery procedures",
                                 pageCompression=1)
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    print(f"Created {args.output}")
    print(f"SHA256 {hashlib.sha256(args.output.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
