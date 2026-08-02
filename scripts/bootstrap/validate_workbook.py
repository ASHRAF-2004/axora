#!/usr/bin/env python3
"""Deterministic, review-only Axora XLSX bootstrap validator.

This tool never connects to a database and never produces import SQL.  It reads
the Open XML parts directly with the Python standard library, inventories the
workbook, and writes sanitized rows to a caller-selected quarantine directory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import posixpath
import re
import stat
import sys
import unicodedata
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable
from xml.etree import ElementTree as ET


FORMAT = "axora.workbook-bootstrap-review.v1"
SCHEMA_PATH = Path(__file__).with_name("workbook_schemas.json")
NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
MAX_ARCHIVE_ENTRIES = 512
MAX_TOTAL_UNCOMPRESSED = 64 * 1024 * 1024
MAX_PART_SIZE = 16 * 1024 * 1024
MAX_SOURCE_SIZE = 64 * 1024 * 1024
MAX_CELLS = 500_000
MAX_STRING_LENGTH = 32_768
REDACTED = "[REDACTED_CREDENTIAL]"

CELL_REF_RE = re.compile(r"^([A-Z]{1,3})([1-9][0-9]{0,6})$")
RANGE_REF_RE = re.compile(
    r"^(?:'[^']+'|[^'!]+!)?\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6})"
    r"(?::\$?([A-Z]{1,3})\$?([1-9][0-9]{0,6}))?$"
)
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
KEY_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$")
PHONE_RE = re.compile(r"^\+?[0-9 ()-]{7,40}$")
PLACEHOLDERS = {"-", "?", "n/a", "na", "none", "null", "tbc", "tbd", "unknown"}
CONTROL_RE = re.compile(r"[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]")
FORMULA_REF_RE = re.compile(
    r"(?:(?:'([^']+)'|([A-Za-z0-9 _()\-]+))!)?\$?([A-Z]{1,3})\$?([1-9][0-9]*)"
    r"(?::\$?([A-Z]{1,3})\$?([1-9][0-9]*))?"
)

CREDENTIAL_HEADER_RE = re.compile(
    r"(?:^|\b)(?:password|passcode|secret|token|credential|private key|api key|"
    r"access key|client secret|recovery code|mfa seed)(?:\b|$)",
    re.IGNORECASE,
)
CREDENTIAL_VALUE_PATTERNS = (
    re.compile(r"^\$2[aby]\$[0-9]{2}\$[./A-Za-z0-9]{53}$"),
    re.compile(r"^\$argon2(?:id|i|d)\$"),
    re.compile(r"^-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
    re.compile(r"^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$"),
    re.compile(r"^(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{16,}$"),
    re.compile(r"^AKIA[0-9A-Z]{16}$"),
)

ANCHOR_GROUPS = {
    "account_roles": (("role_key",),),
    "branches": (("branch_key", "name"),),
    "companies": (("company_key", "name"),),
    "products": (("product_key", "name"),),
    "recurring_products": (
        ("company_key", "product_key"),
        ("company_key", "product_name"),
        ("company_label", "product_key"),
        ("company_label", "product_name"),
    ),
}


class InputError(Exception):
    """An unsafe, malformed, or unsupported input workbook."""


@dataclass(frozen=True)
class Cell:
    row: int
    column: int
    address: str
    value: str
    formula: str | None = None
    cell_type: str | None = None


@dataclass
class Sheet:
    name: str
    state: str
    path: str
    rows: dict[int, dict[int, Cell]]
    dimension: str | None
    merges: list[str]
    validations: list[dict[str, Any]]
    tables: list[dict[str, Any]]

    @property
    def max_row(self) -> int:
        return max(self.rows, default=0)

    @property
    def cell_count(self) -> int:
        return sum(len(row) for row in self.rows.values())


def normalize_header(value: str) -> str:
    value = unicodedata.normalize("NFKC", value).strip().casefold()
    value = value.replace("&", " and ")
    value = re.sub(r"[\s_/\\-]+", " ", value)
    value = re.sub(r"[^\w ()?]+", "", value)
    return re.sub(r"\s+", " ", value).strip()


def canonical_json(value: Any, *, pretty: bool = False) -> str:
    separators = None if pretty else (",", ":")
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        indent=2 if pretty else None,
        separators=separators,
    )


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def col_index(letters: str) -> int:
    value = 0
    for letter in letters:
        value = value * 26 + ord(letter) - 64
    return value


def col_letters(index: int) -> str:
    output = ""
    while index:
        index, remainder = divmod(index - 1, 26)
        output = chr(65 + remainder) + output
    return output


def relationship_part(source: str) -> str:
    return posixpath.join(posixpath.dirname(source), "_rels", posixpath.basename(source) + ".rels")


def relationship_target(source: str, target: str) -> str:
    if "\\" in target or "\x00" in target:
        raise InputError("An OOXML relationship target is unsafe.")
    if target.startswith("/"):
        resolved = posixpath.normpath(target.lstrip("/"))
    else:
        resolved = posixpath.normpath(posixpath.join(posixpath.dirname(source), target))
    if resolved == ".." or resolved.startswith("../") or resolved.startswith("/"):
        raise InputError("An OOXML relationship escapes the workbook archive.")
    return resolved


def cell_text(element: ET.Element) -> str:
    return "".join(node.text or "" for node in element.iter(f"{{{NS}}}t"))


def credential_header(value: str) -> bool:
    return bool(CREDENTIAL_HEADER_RE.search(normalize_header(value)))


def credential_value(value: str) -> bool:
    candidate = value.strip()
    return any(pattern.search(candidate) for pattern in CREDENTIAL_VALUE_PATTERNS)


def sanitized(value: str, header: str = "") -> tuple[str, bool]:
    if value and (credential_header(header) or credential_value(value)):
        return REDACTED, True
    return value, False


def safe_xml(data: bytes, part_name: str) -> ET.Element:
    if len(data) > MAX_PART_SIZE:
        raise InputError(f"OOXML part is too large: {part_name}")
    upper = data.upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise InputError(f"DTD/entity declarations are forbidden: {part_name}")
    try:
        return ET.fromstring(data)
    except ET.ParseError as error:
        raise InputError(f"Malformed OOXML part: {part_name}") from error


class XlsxReader:
    def __init__(self, path: Path):
        self.path = path
        try:
            self.archive = zipfile.ZipFile(path, "r")
        except (OSError, zipfile.BadZipFile) as error:
            raise InputError("The input is not a readable XLSX ZIP archive.") from error
        self.names: set[str] = set()
        self._validate_archive()

    def __enter__(self) -> "XlsxReader":
        return self

    def __exit__(self, *_: Any) -> None:
        self.archive.close()

    def _validate_archive(self) -> None:
        infos = self.archive.infolist()
        if not infos or len(infos) > MAX_ARCHIVE_ENTRIES:
            raise InputError("The XLSX archive has an unsafe number of parts.")
        total = 0
        seen: set[str] = set()
        for info in infos:
            name = info.filename
            if (
                not name
                or "\x00" in name
                or "\\" in name
                or name.startswith("/")
                or posixpath.normpath(name) != name.rstrip("/")
                or name == ".."
                or name.startswith("../")
                or "/../" in name
            ):
                raise InputError("The XLSX archive contains an unsafe part name.")
            if name in seen:
                raise InputError("The XLSX archive contains duplicate part names.")
            seen.add(name)
            if info.flag_bits & 0x1:
                raise InputError("Encrypted ZIP entries are not supported.")
            if info.file_size > MAX_PART_SIZE:
                raise InputError(f"OOXML part is too large: {name}")
            total += info.file_size
        if total > MAX_TOTAL_UNCOMPRESSED:
            raise InputError("The XLSX archive expands beyond the safety limit.")
        self.names = {name.rstrip("/") for name in seen}
        required = {"[Content_Types].xml", "xl/workbook.xml", "xl/_rels/workbook.xml.rels"}
        if not required.issubset(self.names):
            raise InputError("The XLSX archive is missing required workbook parts.")

    def data(self, name: str) -> bytes:
        if name not in self.names:
            raise InputError(f"The XLSX archive is missing a referenced part: {name}")
        try:
            return self.archive.read(name)
        except (OSError, RuntimeError, zipfile.BadZipFile) as error:
            raise InputError(f"Unable to read OOXML part: {name}") from error

    def xml(self, name: str) -> ET.Element:
        return safe_xml(self.data(name), name)

    def relationships(self, source: str) -> list[dict[str, str]]:
        rel_path = relationship_part(source)
        if rel_path not in self.names:
            return []
        root = self.xml(rel_path)
        output = []
        for rel in root.findall(f"{{{PKG_REL_NS}}}Relationship"):
            rel_id = rel.attrib.get("Id", "")
            target = rel.attrib.get("Target", "")
            mode = rel.attrib.get("TargetMode", "Internal")
            rel_type = rel.attrib.get("Type", "")
            if not rel_id or not target:
                raise InputError(f"Malformed relationship in {rel_path}")
            resolved = target if mode == "External" else relationship_target(source, target)
            output.append({"id": rel_id, "target": resolved, "mode": mode, "type": rel_type})
        return output

    def shared_strings(self) -> list[str]:
        if "xl/sharedStrings.xml" not in self.names:
            return []
        root = self.xml("xl/sharedStrings.xml")
        strings = [cell_text(item) for item in root.findall(f"{{{NS}}}si")]
        if any(len(value) > MAX_STRING_LENGTH for value in strings):
            raise InputError("A shared string exceeds the safety limit.")
        return strings

    def read(self) -> tuple[list[Sheet], dict[str, Any], list[dict[str, Any]]]:
        shared = self.shared_strings()
        workbook = self.xml("xl/workbook.xml")
        relationships = {item["id"]: item for item in self.relationships("xl/workbook.xml")}
        external_relationships = [
            {"source": "xl/workbook.xml", "type": rel["type"]}
            for rel in relationships.values() if rel["mode"] == "External"
        ]
        sheets: list[Sheet] = []
        total_cells = 0
        for node in workbook.findall(f".//{{{NS}}}sheet"):
            name = node.attrib.get("name", "").strip()
            state = node.attrib.get("state", "visible")
            rel_id = node.attrib.get(f"{{{REL_NS}}}id", "")
            if not name or rel_id not in relationships:
                raise InputError("A workbook sheet relationship is malformed.")
            rel = relationships[rel_id]
            if rel["mode"] == "External" or rel["target"] not in self.names:
                raise InputError("A worksheet relationship is external or missing.")
            sheet, sheet_external = self._sheet(name, state, rel["target"], shared)
            total_cells += sheet.cell_count
            if total_cells > MAX_CELLS:
                raise InputError("The workbook contains too many populated cells.")
            sheets.append(sheet)
            external_relationships.extend(sheet_external)
        if not sheets:
            raise InputError("The workbook has no worksheets.")
        calc = workbook.find(f"{{{NS}}}calcPr")
        properties = {
            "calculation_mode": calc.attrib.get("calcMode") if calc is not None else None,
            "full_calculation_on_load": calc.attrib.get("fullCalcOnLoad") if calc is not None else None,
            "force_full_calculation": calc.attrib.get("forceFullCalc") if calc is not None else None,
            "shared_string_count": len(shared),
            "archive_part_count": len(self.names),
            "macro_part_present": any(name.lower().endswith("vbaproject.bin") for name in self.names),
            "external_link_part_count": sum(1 for name in self.names if name.startswith("xl/externalLinks/")),
        }
        return sheets, properties, external_relationships

    def _sheet(
        self, name: str, state: str, path: str, shared: list[str]
    ) -> tuple[Sheet, list[dict[str, Any]]]:
        root = self.xml(path)
        rows: dict[int, dict[int, Cell]] = defaultdict(dict)
        for row_node in root.findall(f".//{{{NS}}}sheetData/{{{NS}}}row"):
            fallback_row = int(row_node.attrib.get("r", "0") or 0)
            for cell_node in row_node.findall(f"{{{NS}}}c"):
                address = cell_node.attrib.get("r", "")
                match = CELL_REF_RE.match(address)
                if not match:
                    raise InputError(f"Invalid cell coordinate in worksheet {name}.")
                column = col_index(match.group(1))
                row = int(match.group(2))
                if fallback_row and fallback_row != row:
                    raise InputError(f"Inconsistent row coordinate in worksheet {name}.")
                cell_type = cell_node.attrib.get("t")
                formula_node = cell_node.find(f"{{{NS}}}f")
                value_node = cell_node.find(f"{{{NS}}}v")
                formula = formula_node.text or "" if formula_node is not None else None
                if formula is not None and len(formula) > MAX_STRING_LENGTH:
                    raise InputError("A formula exceeds the safety limit.")
                if cell_type == "inlineStr":
                    value = cell_text(cell_node)
                else:
                    raw = value_node.text or "" if value_node is not None else ""
                    if cell_type == "s" and raw:
                        try:
                            value = shared[int(raw)]
                        except (ValueError, IndexError) as error:
                            raise InputError(f"Invalid shared-string index in worksheet {name}.") from error
                    elif cell_type == "b":
                        value = "true" if raw == "1" else "false"
                    else:
                        value = raw
                if len(value) > MAX_STRING_LENGTH:
                    raise InputError("A worksheet cell exceeds the safety limit.")
                rows[row][column] = Cell(row, column, address, value, formula, cell_type)

        dimension_node = root.find(f"{{{NS}}}dimension")
        dimension = dimension_node.attrib.get("ref") if dimension_node is not None else None
        merges = sorted(
            merge.attrib.get("ref", "")
            for merge in root.findall(f".//{{{NS}}}mergeCell")
            if merge.attrib.get("ref")
        )
        validations = []
        for validation in root.findall(f".//{{{NS}}}dataValidation"):
            formula_node = validation.find(f"{{{NS}}}formula1")
            formula = formula_node.text or "" if formula_node is not None else ""
            literal_values: list[str] | None = None
            if len(formula) >= 2 and formula.startswith('"') and formula.endswith('"'):
                literal_values = [part.strip() for part in formula[1:-1].split(",")]
            safe_literals = None
            if literal_values is not None:
                safe_literals = [sanitized(value)[0] for value in literal_values]
            validations.append({
                "allow_blank": validation.attrib.get("allowBlank"),
                "formula_sha256": sha256_bytes(formula.encode("utf-8")) if formula else None,
                "literal_values": safe_literals,
                "sqref": validation.attrib.get("sqref", ""),
                "type": validation.attrib.get("type", "none"),
            })

        relationships = self.relationships(path)
        external = [
            {"source": path, "type": rel["type"]}
            for rel in relationships if rel["mode"] == "External"
        ]
        tables = []
        for rel in relationships:
            if rel["mode"] != "External" and rel["type"].endswith("/table"):
                table_root = self.xml(rel["target"])
                names = []
                for column in table_root.findall(f".//{{{NS}}}tableColumn"):
                    value, was_redacted = sanitized(column.attrib.get("name", ""))
                    names.append(REDACTED if was_redacted else value)
                tables.append({
                    "display_name": table_root.attrib.get("displayName", ""),
                    "ref": table_root.attrib.get("ref", ""),
                    "columns": names,
                    "part": rel["target"],
                })
        return Sheet(
            name=name,
            state=state,
            path=path,
            rows=dict(rows),
            dimension=dimension,
            merges=merges,
            validations=validations,
            tables=sorted(tables, key=lambda item: (item["ref"], item["display_name"])),
        ), external


def load_schemas() -> dict[str, Any]:
    try:
        schemas = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise InputError("The bundled workbook schema is unavailable or malformed.") from error
    if schemas.get("format") != "axora.workbook-bootstrap-schemas.v1":
        raise InputError("The bundled workbook schema version is unsupported.")
    return schemas


def alias_maps(schemas: dict[str, Any]) -> dict[str, dict[str, str]]:
    output: dict[str, dict[str, str]] = {}
    for entity, definition in schemas["entities"].items():
        aliases: dict[str, str] = {}
        for field, field_definition in definition["fields"].items():
            for alias in field_definition["aliases"]:
                normalized = normalize_header(alias)
                if normalized in aliases and aliases[normalized] != field:
                    raise InputError(f"Ambiguous bundled alias for {entity}: {alias}")
                aliases[normalized] = field
        output[entity] = aliases
    return output


def detect_regions(
    sheets: list[Sheet], schemas: dict[str, Any], aliases: dict[str, dict[str, str]]
) -> list[dict[str, Any]]:
    regions = []
    for sheet in sheets:
        candidates = []
        for row_number in sorted(sheet.rows):
            row = sheet.rows[row_number]
            if row_number > 500:
                continue
            for entity, definition in schemas["entities"].items():
                columns: dict[int, dict[str, str]] = {}
                used_fields: set[str] = set()
                for column, cell in row.items():
                    field = aliases[entity].get(normalize_header(cell.value))
                    if field and field not in used_fields:
                        columns[column] = {"field": field, "header": cell.value.strip()}
                        used_fields.add(field)
                anchors = ANCHOR_GROUPS[entity]
                anchored = any(set(group).issubset(used_fields) for group in anchors)
                if anchored and len(used_fields) >= int(definition["minimum_header_matches"]):
                    candidates.append({
                        "entity": entity,
                        "header_row": row_number,
                        "columns": columns,
                        "score": len(used_fields),
                    })
        by_row: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for candidate in candidates:
            by_row[candidate["header_row"]].append(candidate)
        selected = []
        for row_number, row_candidates in by_row.items():
            row_candidates.sort(key=lambda item: (-item["score"], item["entity"]))
            best = row_candidates[0]
            if len(row_candidates) > 1 and row_candidates[1]["score"] == best["score"]:
                continue
            selected.append(best)
        selected.sort(key=lambda item: item["header_row"])
        for index, region in enumerate(selected):
            has_next_header = index + 1 < len(selected)
            next_header = selected[index + 1]["header_row"] if has_next_header else sheet.max_row + 1
            last_data_row = max(region["header_row"], next_header - 1)
            if has_next_header:
                boundary_values = [
                    cell.value.strip()
                    for cell in sheet.rows.get(next_header - 1, {}).values()
                    if cell.value.strip() or cell.formula is not None
                ]
                if len(boundary_values) == 1:
                    last_data_row = max(region["header_row"], next_header - 2)
            context = None
            previous = sheet.rows.get(region["header_row"] - 1, {})
            previous_values = [cell.value.strip() for cell in previous.values() if cell.value.strip()]
            if len(previous_values) == 1:
                context, _ = sanitized(previous_values[0])
            regions.append({
                "sheet": sheet.name,
                "entity": region["entity"],
                "header_row": region["header_row"],
                "first_data_row": region["header_row"] + 1,
                "last_data_row": last_data_row,
                "columns": region["columns"],
                "source_context": {"company_label": context} if context else {},
            })
    return regions


def issue(
    code: str,
    message: str,
    *,
    severity: str = "error",
    sheet: str | None = None,
    row: int | None = None,
    column: str | None = None,
    entity: str | None = None,
    field: str | None = None,
) -> dict[str, Any]:
    return {
        key: value
        for key, value in {
            "code": code,
            "column": column,
            "entity": entity,
            "field": field,
            "message": message,
            "row": row,
            "severity": severity,
            "sheet": sheet,
        }.items()
        if value is not None
    }


def enum_value(value: str, allowed: list[str]) -> tuple[str | None, dict[str, str] | None]:
    normalized = re.sub(r"[\s-]+", "_", value.strip()).upper()
    matches = {item.upper(): item for item in allowed}
    result = matches.get(normalized)
    if not result:
        return None, None
    change = None
    if result != value:
        change = {"rule": "explicit_enum_case_and_separator", "source": value, "result": result}
    return result, change


def normalize_value(
    value: str,
    field: str,
    definition: dict[str, Any],
    schemas: dict[str, Any],
) -> tuple[Any | None, list[dict[str, str]], str | None]:
    original = value
    value = unicodedata.normalize("NFKC", value).strip()
    changes: list[dict[str, str]] = []
    if not value:
        return None, changes, None
    if CONTROL_RE.search(value):
        return None, changes, "control_characters_forbidden"
    if len(value) > 2_000:
        return None, changes, "value_too_long"
    if value.casefold() in PLACEHOLDERS:
        return None, changes, "placeholder_value_forbidden"
    value_type = definition["type"]
    if value_type == "string":
        if value != original:
            changes.append({"rule": "unicode_nfkc_and_trim", "source": original, "result": value})
        return value, changes, None
    if value_type == "key":
        if not KEY_RE.fullmatch(value):
            return None, changes, "invalid_stable_key"
        if value != original:
            changes.append({"rule": "unicode_nfkc_and_trim", "source": original, "result": value})
        return value, changes, None
    if value_type == "email":
        normalized = value.casefold()
        if len(normalized) > 254 or not EMAIL_RE.fullmatch(normalized):
            return None, changes, "invalid_email"
        if normalized != original:
            changes.append({"rule": "email_casefold_and_trim", "source": original, "result": normalized})
        return normalized, changes, None
    if value_type == "phone":
        if not PHONE_RE.fullmatch(value):
            return None, changes, "invalid_phone"
        return value, changes, None
    if value_type == "decimal":
        try:
            number = Decimal(value.replace(",", ""))
        except InvalidOperation:
            return None, changes, "invalid_decimal"
        if not number.is_finite():
            return None, changes, "invalid_decimal"
        if "minimum" in definition and number < Decimal(definition["minimum"]):
            return None, changes, "decimal_below_minimum"
        if "exclusive_minimum" in definition and number <= Decimal(definition["exclusive_minimum"]):
            return None, changes, "decimal_not_above_minimum"
        normalized = format(number, "f")
        if "." in normalized:
            normalized = normalized.rstrip("0").rstrip(".") or "0"
        if normalized != original:
            changes.append({"rule": "canonical_decimal", "source": original, "result": normalized})
        return normalized, changes, None
    if value_type == "boolean":
        mapping = schemas["normalizations"]["boolean"]
        key = value.casefold()
        if key not in mapping:
            return None, changes, "invalid_boolean"
        result = mapping[key]
        changes.append({"rule": "explicit_boolean", "source": original, "result": str(result).lower()})
        return result, changes, None
    if value_type == "enum":
        result, change = enum_value(value, definition["enum"])
        if result is None:
            return None, changes, "invalid_enum"
        if change:
            changes.append(change)
        return result, changes, None
    if value_type == "role":
        scope_roles = set(schemas["normalizations"]["scope_by_role"])
        canonical = re.sub(r"[\s-]+", "_", value).upper()
        if canonical in scope_roles:
            if canonical != original:
                changes.append({"rule": "canonical_role_key", "source": original, "result": canonical})
            return canonical, changes, None
        role_aliases = {key.casefold(): result for key, result in schemas["normalizations"]["roles"].items()}
        result = role_aliases.get(value.casefold())
        if not result:
            return None, changes, "unknown_role_mapping"
        changes.append({"rule": "explicit_role_alias", "source": original, "result": result})
        return result, changes, None
    return None, changes, "unsupported_field_type"


def extract_rows(
    sheets: list[Sheet],
    regions: list[dict[str, Any]],
    schemas: dict[str, Any],
) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, Any]]]:
    sheet_map = {sheet.name: sheet for sheet in sheets}
    output: dict[str, list[dict[str, Any]]] = {
        entity: [] for entity in schemas["entities"]
    }
    issues: list[dict[str, Any]] = []
    for region in regions:
        sheet = sheet_map[region["sheet"]]
        entity = region["entity"]
        definition = schemas["entities"][entity]
        field_columns = {
            column: data for column, data in region["columns"].items()
        }
        all_headers = {
            column: sheet.rows[region["header_row"]][column].value.strip()
            for column in sheet.rows.get(region["header_row"], {})
        }
        for column, header in all_headers.items():
            if credential_header(header):
                issues.append(issue(
                    "credential_column_forbidden",
                    "Credential-bearing workbook columns are forbidden.",
                    sheet=sheet.name,
                    row=region["header_row"],
                    column=col_letters(column),
                    entity=entity,
                ))
        for row_number in range(region["first_data_row"], region["last_data_row"] + 1):
            source_row = sheet.rows.get(row_number, {})
            populated_known = sum(
                1 for column in field_columns
                if source_row.get(column) and (source_row[column].value.strip() or source_row[column].formula is not None)
            )
            if populated_known < 1:
                continue
            row_issues: list[dict[str, Any]] = []
            source_cells: dict[str, Any] = {}
            candidate: dict[str, Any] = {}
            normalizations: list[dict[str, str]] = []
            for column, header in sorted(all_headers.items()):
                cell = source_row.get(column)
                if cell is None or (not cell.value and cell.formula is None):
                    continue
                value, redacted = sanitized(cell.value, header)
                source_cells[col_letters(column)] = {
                    "formula": cell.formula is not None,
                    "header": header,
                    "value": value,
                }
                if redacted:
                    row_issues.append(issue(
                        "credential_material_forbidden",
                        "Credential-like material was rejected and redacted.",
                        sheet=sheet.name,
                        row=row_number,
                        column=col_letters(column),
                        entity=entity,
                    ))
            for column, header_data in sorted(field_columns.items()):
                field = header_data["field"]
                cell = source_row.get(column)
                if cell is None or (not cell.value.strip() and cell.formula is None):
                    continue
                if cell.formula is not None:
                    row_issues.append(issue(
                        "formula_not_importable",
                        "Formula cells cannot supply bootstrap entity values.",
                        sheet=sheet.name,
                        row=row_number,
                        column=col_letters(column),
                        entity=entity,
                        field=field,
                    ))
                    continue
                safe_value, was_redacted = sanitized(cell.value, header_data["header"])
                if was_redacted:
                    continue
                normalized, changes, error_code = normalize_value(
                    safe_value, field, definition["fields"][field], schemas
                )
                for change in changes:
                    normalizations.append({"field": field, **change})
                if error_code:
                    row_issues.append(issue(
                        error_code,
                        f"Field {field} failed explicit {definition['fields'][field]['type']} validation.",
                        sheet=sheet.name,
                        row=row_number,
                        column=col_letters(column),
                        entity=entity,
                        field=field,
                    ))
                elif normalized is not None:
                    candidate[field] = normalized
            for field, field_definition in definition["fields"].items():
                if field_definition.get("required") and field not in candidate:
                    row_issues.append(issue(
                        "missing_required_field",
                        f"Required field {field} is absent; no value was invented.",
                        sheet=sheet.name,
                        row=row_number,
                        entity=entity,
                        field=field,
                    ))
            if entity == "account_roles" and "role_key" in candidate:
                role = candidate["role_key"]
                scope = schemas["normalizations"]["scope_by_role"][role]
                if role == "PLATFORM_OWNER":
                    row_issues.append(issue(
                        "platform_owner_workbook_forbidden",
                        "PLATFORM_OWNER must use the separate audited first-owner bootstrap command.",
                        sheet=sheet.name,
                        row=row_number,
                        entity=entity,
                        field="role_key",
                    ))
                if scope == "COMPANY" and "company_key" not in candidate:
                    row_issues.append(issue(
                        "missing_role_company_scope",
                        "This role requires an explicit stable company key.",
                        sheet=sheet.name,
                        row=row_number,
                        entity=entity,
                        field="company_key",
                    ))
                if scope == "BRANCH" and (
                    "company_key" not in candidate or "branch_key" not in candidate
                ):
                    row_issues.append(issue(
                        "missing_role_branch_scope",
                        "This role requires explicit stable company and branch keys.",
                        sheet=sheet.name,
                        row=row_number,
                        entity=entity,
                        field="branch_key",
                    ))
                if scope in {"PLATFORM", "DELIVERY"} and (
                    "company_key" in candidate or "branch_key" in candidate
                ):
                    row_issues.append(issue(
                        "role_scope_conflict",
                        "This platform/delivery role cannot carry company or branch scope.",
                        sheet=sheet.name,
                        row=row_number,
                        entity=entity,
                        field="role_key",
                    ))
                if scope == "SUPPLIER":
                    row_issues.append(issue(
                        "role_scope_not_supported_by_schema",
                        "Supplier membership needs an explicit supplier schema and cannot be inferred here.",
                        sheet=sheet.name,
                        row=row_number,
                        entity=entity,
                        field="role_key",
                    ))
            row_issues = dedupe_issues(row_issues)
            sanitized_source = {
                "context": region["source_context"],
                "cells": source_cells,
            }
            output[entity].append({
                "candidate": candidate,
                "issues": row_issues,
                "normalizations": sorted(normalizations, key=lambda item: (item["field"], item["rule"])),
                "source": {
                    "row": row_number,
                    "row_sha256": sha256_bytes(canonical_json(sanitized_source).encode("utf-8")),
                    "sheet": sheet.name,
                    **({"context": region["source_context"]} if region["source_context"] else {}),
                },
                "source_cells": source_cells,
                "status": "candidate" if not row_issues else "quarantined",
            })
            issues.extend(row_issues)
    return output, issues


def dedupe_issues(issues: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    seen = set()
    result = []
    for item in issues:
        key = canonical_json(item)
        if key not in seen:
            seen.add(key)
            result.append(item)
    return result


def cross_validate(
    entities: dict[str, list[dict[str, Any]]], regions: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    region_entities = Counter(region["entity"] for region in regions)
    for entity in entities:
        if not region_entities[entity]:
            issues.append(issue(
                "entity_region_not_found",
                f"No recognizable {entity} header region was found.",
                entity=entity,
            ))

    key_fields = {
        "companies": "company_key",
        "branches": "branch_key",
        "products": "product_key",
        "account_roles": "email",
    }
    for entity, key_field in key_fields.items():
        seen: dict[str, dict[str, Any]] = {}
        for row in entities[entity]:
            key = row["candidate"].get(key_field)
            if not key:
                continue
            normalized_key = str(key).casefold()
            if normalized_key in seen:
                duplicate = issue(
                    "duplicate_entity_key",
                    f"Duplicate {key_field} is ambiguous and was not merged.",
                    sheet=row["source"]["sheet"],
                    row=row["source"]["row"],
                    entity=entity,
                    field=key_field,
                )
                row["issues"].append(duplicate)
                row["status"] = "quarantined"
                issues.append(duplicate)
            else:
                seen[normalized_key] = row

    company_keys = {
        row["candidate"]["company_key"].casefold()
        for row in entities["companies"] if "company_key" in row["candidate"]
    }
    product_keys = {
        row["candidate"]["product_key"].casefold()
        for row in entities["products"] if "product_key" in row["candidate"]
    }
    branch_keys = {
        row["candidate"]["branch_key"].casefold()
        for row in entities["branches"] if "branch_key" in row["candidate"]
    }
    reference_rules = {
        "branches": (("company_key", company_keys, "company"),),
        "recurring_products": (
            ("company_key", company_keys, "company"),
            ("product_key", product_keys, "product"),
        ),
        "account_roles": (
            ("company_key", company_keys, "company"),
            ("branch_key", branch_keys, "branch"),
        ),
    }
    for entity, rules in reference_rules.items():
        for row in entities[entity]:
            for field, available, label in rules:
                value = row["candidate"].get(field)
                if value and value.casefold() not in available:
                    reference_issue = issue(
                        "unresolved_reference",
                        f"The explicit {label} reference does not match a workbook master key.",
                        sheet=row["source"]["sheet"],
                        row=row["source"]["row"],
                        entity=entity,
                        field=field,
                    )
                    row["issues"].append(reference_issue)
                    row["status"] = "quarantined"
                    issues.append(reference_issue)
    return issues


def region_for_cell(regions: list[dict[str, Any]], sheet: str, row: int) -> dict[str, Any] | None:
    for region in regions:
        if (
            region["sheet"] == sheet
            and region["header_row"] <= row <= region["last_data_row"]
        ):
            return region
    return None


def workbook_diagnostics(
    sheets: list[Sheet],
    regions: list[dict[str, Any]],
    schemas: dict[str, Any],
    properties: dict[str, Any],
    external_relationships: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    issues: list[dict[str, Any]] = []
    sheet_map = {sheet.name: sheet for sheet in sheets}
    if properties["macro_part_present"]:
        issues.append(issue("macro_part_forbidden", "Macro-bearing workbook parts are forbidden."))
    if properties["external_link_part_count"]:
        issues.append(issue("external_link_part_forbidden", "External workbook link parts are forbidden."))
    for rel in external_relationships:
        issues.append(issue(
            "external_relationship_forbidden",
            f"External OOXML relationship is forbidden ({rel['type'].rsplit('/', 1)[-1]}).",
        ))

    for sheet in sheets:
        credential_columns: dict[int, int] = {}
        for row_number, row in sheet.rows.items():
            for column, cell in row.items():
                candidate_header = cell.value.strip()
                if (
                    candidate_header
                    and len(candidate_header) <= 80
                    and len(candidate_header.split()) <= 6
                    and credential_header(candidate_header)
                ):
                    credential_columns[column] = min(
                        row_number,
                        credential_columns.get(column, row_number),
                    )
                    issues.append(issue(
                        "credential_column_forbidden",
                        "Credential-bearing workbook columns are forbidden anywhere in the workbook.",
                        sheet=sheet.name,
                        row=row_number,
                        column=col_letters(column),
                    ))
        for row_number, row in sheet.rows.items():
            region = region_for_cell(regions, sheet.name, row_number)
            header_map: dict[int, str] = {}
            if region:
                header_row = sheet.rows.get(region["header_row"], {})
                header_map = {column: cell.value for column, cell in header_row.items()}
            for column, cell in row.items():
                header = header_map.get(column, "")
                under_credential_header = (
                    column in credential_columns
                    and row_number > credential_columns[column]
                )
                if row_number != (region or {}).get("header_row") and cell.value and (
                    credential_header(header)
                    or credential_value(cell.value)
                    or under_credential_header
                ):
                    issues.append(issue(
                        "credential_material_forbidden",
                        "Credential-like material was rejected and will only appear as a redaction marker.",
                        sheet=sheet.name,
                        row=row_number,
                        column=col_letters(column),
                        entity=region["entity"] if region else None,
                    ))
                if cell.formula is not None and re.search(
                    r"(?:WEBSERVICE|RTD|DDE|HYPERLINK)\s*\(", cell.formula, re.IGNORECASE
                ):
                    issues.append(issue(
                        "external_formula_forbidden",
                        "Formula may invoke an external resource and is forbidden.",
                        sheet=sheet.name,
                        row=row_number,
                        column=col_letters(column),
                    ))

        for validation in sheet.validations:
            sqrefs = validation["sqref"].split()
            if not sqrefs:
                issues.append(issue(
                    "invalid_validation_range",
                    "Data validation has no target range.",
                    sheet=sheet.name,
                ))
                continue
            literal_values = validation.get("literal_values")
            domain = None
            if literal_values:
                values = {value.casefold().replace("-", "_").replace(" ", "_") for value in literal_values}
                if values and values <= {"yes", "no", "true", "false"}:
                    domain = "boolean"
                elif values and values <= {"active", "inactive", "discontinued"}:
                    domain = "status"
                elif values and values <= {"weekly", "monthly", "quarterly", "ad_hoc"}:
                    domain = "frequency"
            for sqref in sqrefs:
                match = RANGE_REF_RE.match(sqref.replace("$", ""))
                if not match:
                    issues.append(issue(
                        "invalid_validation_range",
                        "Data validation target range is malformed.",
                        sheet=sheet.name,
                    ))
                    continue
                column = col_index(match.group(1))
                first_row = int(match.group(2))
                region = region_for_cell(regions, sheet.name, first_row)
                if not domain or not region or column not in region["columns"]:
                    continue
                field = region["columns"][column]["field"]
                field_type = schemas["entities"][region["entity"]]["fields"][field]["type"]
                expected = "boolean" if domain == "boolean" else "enum"
                if field_type != expected or (domain == "status" and field != "status") or (
                    domain == "frequency" and field != "frequency"
                ):
                    issues.append(issue(
                        "validation_domain_mismatch",
                        "Data-validation choices do not match the target schema field.",
                        sheet=sheet.name,
                        row=first_row,
                        column=col_letters(column),
                        entity=region["entity"],
                        field=field,
                    ))

        for table in sheet.tables:
            match = RANGE_REF_RE.match(table["ref"])
            if not match:
                issues.append(issue(
                    "invalid_table_range", "Excel table range is malformed.", sheet=sheet.name
                ))
                continue
            header_row_number = int(match.group(2))
            region = next(
                (
                    item for item in regions
                    if item["sheet"] == sheet.name and item["header_row"] == header_row_number
                ),
                None,
            )
            if not region:
                issues.append(issue(
                    "table_header_not_schema_header",
                    "Excel table begins on a populated row that is not a recognized schema header.",
                    sheet=sheet.name,
                    row=header_row_number,
                ))

    boolean_fields = set()
    for entity, definition in schemas["entities"].items():
        boolean_fields.update(
            (entity, field) for field, spec in definition["fields"].items() if spec["type"] == "boolean"
        )
    for sheet in sheets:
        for row in sheet.rows.values():
            for cell in row.values():
                if cell.formula is None or not re.search(r'"(?:yes|no|true|false)"', cell.formula, re.I):
                    continue
                if not re.search(r"COUNTIF", cell.formula, re.I):
                    continue
                for match in FORMULA_REF_RE.finditer(cell.formula):
                    target_name = match.group(1) or (match.group(2) or "").strip() or sheet.name
                    target_sheet = sheet_map.get(target_name)
                    if not target_sheet:
                        continue
                    target_row = int(match.group(4))
                    target_column = col_index(match.group(3))
                    target_region = region_for_cell(regions, target_name, target_row)
                    if not target_region or target_column not in target_region["columns"]:
                        continue
                    field = target_region["columns"][target_column]["field"]
                    if (target_region["entity"], field) not in boolean_fields:
                        issues.append(issue(
                            "formula_domain_mismatch",
                            "COUNTIF(S) boolean criterion references a non-boolean schema field.",
                            sheet=sheet.name,
                            row=cell.row,
                            column=col_letters(cell.column),
                        ))
    return dedupe_issues(issues)


def formula_inventory(sheet: Sheet) -> list[dict[str, Any]]:
    formulas = []
    for row in sheet.rows.values():
        for cell in row.values():
            if cell.formula is None:
                continue
            functions = sorted(set(re.findall(r"\b([A-Z][A-Z0-9_.]*)\s*\(", cell.formula.upper())))
            references = []
            for match in FORMULA_REF_RE.finditer(cell.formula):
                references.append({
                    "sheet": match.group(1) or (match.group(2) or "").strip() or sheet.name,
                    "column": match.group(3),
                    "row": int(match.group(4)),
                })
            cached, redacted = sanitized(cell.value)
            formulas.append({
                "address": cell.address,
                "cached_value": REDACTED if redacted else cached,
                "expression_sha256": sha256_bytes(cell.formula.encode("utf-8")),
                "functions": functions,
                "references": references,
            })
    return sorted(formulas, key=lambda item: item["address"])


def workbook_inventory(
    sheets: list[Sheet], properties: dict[str, Any], regions: list[dict[str, Any]]
) -> dict[str, Any]:
    output_sheets = []
    for sheet in sheets:
        sheet_regions = [region for region in regions if region["sheet"] == sheet.name]
        output_sheets.append({
            "cell_count": sheet.cell_count,
            "detected_regions": [
                {
                    "columns": {
                        col_letters(column): data["field"]
                        for column, data in sorted(region["columns"].items())
                    },
                    "entity": region["entity"],
                    "first_data_row": region["first_data_row"],
                    "header_row": region["header_row"],
                    "last_data_row": region["last_data_row"],
                    "source_context": region["source_context"],
                }
                for region in sheet_regions
            ],
            "dimension": sheet.dimension,
            "formula_count": len(formula_inventory(sheet)),
            "formulas": formula_inventory(sheet),
            "max_populated_row": sheet.max_row,
            "merged_ranges": sheet.merges,
            "name": sheet.name,
            "state": sheet.state,
            "tables": sheet.tables,
            "validations": sorted(
                sheet.validations,
                key=lambda item: (item["sqref"], item["type"], item["formula_sha256"] or ""),
            ),
        })
    return {"properties": properties, "sheets": output_sheets}


def report_schemas(schemas: dict[str, Any]) -> dict[str, Any]:
    return {
        "format": schemas["format"],
        "entities": schemas["entities"],
        "normalizations": schemas["normalizations"],
        "invariants": [
            "No database connection or import statement is available to this tool.",
            "Every extracted row is retained in quarantine, including valid candidates.",
            "Missing values and stable keys are never synthesized from labels or row order.",
            "Only aliases and enum mappings enumerated in this report may normalize values.",
            "Credential-like columns and values are blocking and redacted before output.",
            "PLATFORM_OWNER is forbidden in workbook rows and has a separate audited command.",
        ],
    }


def write_outputs(
    output_dir: Path,
    report: dict[str, Any],
    entities: dict[str, list[dict[str, Any]]],
) -> None:
    try:
        os.mkdir(output_dir, 0o700)
        quarantine = output_dir / "quarantine"
        os.mkdir(quarantine, 0o700)
        report_path = output_dir / "import-report.json"
        with report_path.open("x", encoding="utf-8", newline="\n") as handle:
            handle.write(canonical_json(report, pretty=True) + "\n")
        os.chmod(report_path, 0o600)
        for entity in sorted(entities):
            target = quarantine / f"{entity}.jsonl"
            with target.open("x", encoding="utf-8", newline="\n") as handle:
                for row in sorted(
                    entities[entity], key=lambda item: (item["source"]["sheet"], item["source"]["row"])
                ):
                    handle.write(canonical_json(row) + "\n")
            os.chmod(target, 0o600)
    except OSError as error:
        raise InputError("Unable to create the private review output directory.") from error


def validate_paths(workbook: str, output: str) -> tuple[Path, Path]:
    source = Path(workbook)
    try:
        source_lstat = source.lstat()
    except OSError as error:
        raise InputError("The workbook path is unavailable.") from error
    if stat.S_ISLNK(source_lstat.st_mode) or not stat.S_ISREG(source_lstat.st_mode):
        raise InputError("The workbook must be a regular, non-symlink file.")
    if source_lstat.st_size > MAX_SOURCE_SIZE:
        raise InputError("The workbook exceeds the compressed source safety limit.")
    if source.suffix.casefold() != ".xlsx":
        raise InputError("Only macro-free .xlsx workbooks are accepted.")
    source = source.resolve(strict=True)
    output_dir = Path(output)
    if output_dir.exists() or output_dir.is_symlink():
        raise InputError("The output directory must not already exist.")
    if output_dir.parent.is_symlink():
        raise InputError("The output directory parent must not be a symlink.")
    try:
        parent = output_dir.parent.resolve(strict=True)
    except OSError as error:
        raise InputError("The output directory parent must already exist.") from error
    if not parent.is_dir() or parent.is_symlink():
        raise InputError("The output directory parent must be a real directory.")
    return source, parent / output_dir.name


def run(workbook_path: Path, output_dir: Path) -> tuple[dict[str, Any], dict[str, list[dict[str, Any]]]]:
    source_bytes = workbook_path.read_bytes()
    schemas = load_schemas()
    aliases = alias_maps(schemas)
    with XlsxReader(workbook_path) as reader:
        sheets, properties, external_relationships = reader.read()
    regions = detect_regions(sheets, schemas, aliases)
    entities, row_issues = extract_rows(sheets, regions, schemas)
    all_issues = row_issues
    all_issues.extend(cross_validate(entities, regions))
    all_issues.extend(
        workbook_diagnostics(
            sheets, regions, schemas, properties, external_relationships
        )
    )
    all_issues = sorted(
        dedupe_issues(all_issues),
        key=lambda item: (
            item.get("severity", ""),
            item.get("code", ""),
            item.get("sheet", ""),
            item.get("row", -1),
            item.get("column", ""),
            item.get("entity", ""),
            item.get("field", ""),
        ),
    )
    issue_counts = Counter(item["severity"] for item in all_issues)
    summaries = {}
    for entity, rows in entities.items():
        summaries[entity] = {
            "candidate_rows": sum(row["status"] == "candidate" for row in rows),
            "extracted_rows": len(rows),
            "quarantined_rows": sum(row["status"] == "quarantined" for row in rows),
        }
    blocked = bool(issue_counts["error"])
    report = {
        "format": FORMAT,
        "mode": "review_only_no_import",
        "source": {
            "path": str(workbook_path),
            "sha256": sha256_bytes(source_bytes),
            "size_bytes": len(source_bytes),
        },
        "verdict": "blocked" if blocked else "review_ready",
        "issue_counts": dict(sorted(issue_counts.items())),
        "issues": all_issues,
        "entity_summary": summaries,
        "inventory": workbook_inventory(sheets, properties, regions),
        "schemas": report_schemas(schemas),
        "outputs": {
            "report": "import-report.json",
            "quarantine_directory": "quarantine",
            "production_import_performed": False,
        },
    }
    return report, entities


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Inventory and quarantine an XLSX workbook without importing it."
    )
    parser.add_argument("--workbook", required=True, help="Path to a regular .xlsx file")
    parser.add_argument(
        "--output-dir",
        required=True,
        help="New caller-selected directory for the private report and quarantine",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    try:
        workbook, output_dir = validate_paths(args.workbook, args.output_dir)
        report, entities = run(workbook, output_dir)
        write_outputs(output_dir, report, entities)
    except InputError as error:
        print(f"workbook validation failed: {error}", file=sys.stderr)
        return 2
    print(f"Review report: {output_dir / 'import-report.json'}")
    print(f"Verdict: {report['verdict']}")
    return 1 if report["verdict"] == "blocked" else 0


if __name__ == "__main__":
    raise SystemExit(main())
