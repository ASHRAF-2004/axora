#!/usr/bin/env python3
"""Create tiny deterministic XLSX fixtures for bootstrap-validator tests."""

from __future__ import annotations

import html
import sys
import zipfile
from pathlib import Path


def cell_ref(column: int, row: int) -> str:
    letters = ""
    while column:
        column, remainder = divmod(column - 1, 26)
        letters = chr(65 + remainder) + letters
    return f"{letters}{row}"


def worksheet(rows: list[list[object]]) -> str:
    row_xml = []
    for row_number, values in enumerate(rows, start=1):
        cells = []
        for column, value in enumerate(values, start=1):
            if value is None:
                continue
            reference = cell_ref(column, row_number)
            if isinstance(value, dict):
                formula = html.escape(str(value["formula"]))
                cached = html.escape(str(value.get("cached", "")))
                cells.append(f'<c r="{reference}"><f>{formula}</f><v>{cached}</v></c>')
            elif isinstance(value, (int, float)):
                cells.append(f'<c r="{reference}"><v>{value}</v></c>')
            else:
                text = html.escape(str(value))
                cells.append(f'<c r="{reference}" t="inlineStr"><is><t>{text}</t></is></c>')
        row_xml.append(f'<row r="{row_number}">{"".join(cells)}</row>')
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(row_xml)}</sheetData></worksheet>'
    )


def fixture(mode: str) -> list[tuple[str, list[list[object]]]]:
    sheets = [
        ("Companies", [
            ["Company Key", "Company Name", "Active"],
            ["COMPANY-001", "Example Company", "Yes"],
        ]),
        ("Branches", [
            ["Company Key", "Branch Key", "Branch Name", "Branch Code", "Delivery Address", "City / Area", "Contact Phone", "Active"],
            [
                "COMPANY-001", "BRANCH-001", "Main Branch", "MAIN", "1 Example Road",
                "Kuala Lumpur", "+60 12 345 6789", "Yes",
            ],
        ]),
        ("Products", [
            ["Product Key", "Product Name", "Category", "Unit", "Size", "Buy Price", "Sell Price", "Status", "Confirmed"],
            ["PRODUCT-001", "Safety Gloves", "PPE", "box", "Medium", "10.00", "12.50", "Active", "Yes"],
        ]),
        ("Recurring Products", [
            ["Company Key", "Product Key", "Frequency", "Estimated Quantity", "Request Source", "Confirmed"],
            ["COMPANY-001", "PRODUCT-001", "Monthly", "2", "Operator Entry", "Yes"],
        ]),
        ("Account Roles", [
            ["Email", "Display Name", "Role", "Company Key", "Branch Key", "Locale"],
            ["requester@example.test", "Example Requester", "Purchase Requester", "COMPANY-001", "BRANCH-001", "en"],
        ]),
    ]
    if mode == "valid":
        return sheets
    if mode != "adversarial":
        raise ValueError("mode must be valid or adversarial")
    sheets[1][1][1][6] = {"formula": "6018-B25", "cached": "5993"}
    sheets[4][1][0].append("Password")
    sheets[4][1][1][2] = "Super Admin"
    sheets[4][1][1].append("CorrectHorseBatteryStaple!2026")
    return sheets


def write_fixture(mode: str, target: Path) -> None:
    if target.exists():
        raise FileExistsError(target)
    sheets = fixture(mode)
    sheet_nodes = "".join(
        f'<sheet name="{html.escape(name)}" sheetId="{index}" r:id="rId{index}"/>'
        for index, (name, _) in enumerate(sheets, start=1)
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets>{sheet_nodes}</sheets></workbook>'
    )
    workbook_rels = "".join(
        '<Relationship '
        f'Id="rId{index}" Target="worksheets/sheet{index}.xml" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/>'
        for index in range(1, len(sheets) + 1)
    )
    workbook_relationships = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'{workbook_rels}</Relationships>'
    )
    root_relationships = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Target="xl/workbook.xml" '
        'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/>'
        '</Relationships>'
    )
    overrides = "".join(
        f'<Override PartName="/xl/worksheets/sheet{index}.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for index in range(1, len(sheets) + 1)
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        f'{overrides}</Types>'
    )
    parts = {
        "[Content_Types].xml": content_types,
        "_rels/.rels": root_relationships,
        "xl/_rels/workbook.xml.rels": workbook_relationships,
        "xl/workbook.xml": workbook,
    }
    for index, (_, rows) in enumerate(sheets, start=1):
        parts[f"xl/worksheets/sheet{index}.xml"] = worksheet(rows)
    with zipfile.ZipFile(target, "x", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(parts):
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, parts[name].encode("utf-8"))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: build_xlsx_fixture.py valid|adversarial OUTPUT.xlsx")
    write_fixture(sys.argv[1], Path(sys.argv[2]))
