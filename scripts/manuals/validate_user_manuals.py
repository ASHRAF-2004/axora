#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pymupdf==1.26.4"]
# ///
"""Validate and render the exact Axora manual publication set."""

from __future__ import annotations

import argparse
import hashlib
import re
import shutil
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf"
PUBLISH = ROOT / "public" / "manuals"
RENDER = ROOT / "output" / "playwright" / "manuals" / "rendered"
FILES = {
    "axora-company-user-manual-en.pdf": 13,
    "axora-company-user-manual-ar.pdf": 13,
    "axora-owner-admin-manual-en.pdf": 14,
    "axora-owner-admin-manual-ar.pdf": 14,
}
FORBIDDEN = (
    re.compile(r"\bsidebar\b", re.I),
    re.compile(r"\btemporary password\b", re.I),
    re.compile(r"\binitial password\b", re.I),
    re.compile(r"\binteractive[- ]experience\b", re.I),
    re.compile(r"screenshot pending", re.I),
    re.compile(r"placeholder", re.I),
    re.compile(r"\{\{[^}]+\}\}"),
    re.compile(r"\b(?:USER_DISPLAY_NAME|SETUP_URL|EXPIRES_AT|ROLE_NAME|BRANCH_NAME_BLOCK)\b"),
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def exact_pdfs(directory: Path) -> set[str]:
    return {path.name for path in directory.glob("*.pdf")}


def validate_pdf(path: Path, pages: int, render_dir: Path) -> list[str]:
    errors: list[str] = []
    if path.stat().st_size < 50_000:
        errors.append(f"{path}: unexpectedly small ({path.stat().st_size} bytes)")
    document = fitz.open(path)
    if document.page_count != pages:
        errors.append(f"{path}: expected {pages} pages, found {document.page_count}")
    fonts: set[str] = set()
    full_text: list[str] = []
    target = render_dir / path.stem
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)
    for number, page in enumerate(document, 1):
        if page.rect.width <= page.rect.height:
            errors.append(f"{path}: page {number} is not landscape")
        page_text = page.get_text("text")
        full_text.append(page_text)
        if len(page_text.strip()) < 80:
            errors.append(f"{path}: page {number} has too little extractable text")
        for font in page.get_fonts(full=True):
            fonts.add(str(font[3]))
        for block in page.get_text("blocks"):
            x0, y0, x1, y1 = block[:4]
            if x0 < -1 or y0 < -1 or x1 > page.rect.width + 1 or y1 > page.rect.height + 1:
                errors.append(f"{path}: page {number} contains clipped text at {block[:4]}")
        pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
        if pixmap.width < 1000 or pixmap.height < 700:
            errors.append(f"{path}: page {number} rendered below inspection resolution")
        pixmap.save(target / f"page-{number:02d}.png")
    content = "\n".join(full_text)
    for pattern in FORBIDDEN:
        if pattern.search(content):
            errors.append(f"{path}: forbidden or unresolved wording matched {pattern.pattern!r}")
    if "ar.pdf" in path.name:
        if not any("NotoSansArabic" in font for font in fonts):
            errors.append(f"{path}: Noto Sans Arabic is not embedded")
    elif not any("NotoSans" in font and "Arabic" not in font for font in fonts):
        errors.append(f"{path}: Noto Sans is not embedded")
    if "owner" in path.name and "en.pdf" in path.name:
        for required in ("authorized Axora Platform Owners", "internal workspace", "Delivery Driver", "Receiving User"):
            if required not in content:
                errors.append(f"{path}: missing required owner guidance {required!r}")
        if "Supplier User" in content:
            errors.append(f"{path}: removed supplier actor guidance is present")
    if "company" in path.name and "en.pdf" in path.name:
        for required in ("one-time invitation", "hamburger", "self", "three-way", "payment"):
            if required.lower() not in content.lower():
                errors.append(f"{path}: missing required company guidance {required!r}")
    document.close()
    return errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", type=Path, default=OUTPUT)
    parser.add_argument("--publish-dir", type=Path, default=PUBLISH)
    parser.add_argument("--render-dir", type=Path, default=RENDER)
    parser.add_argument("--compare-dir", type=Path)
    args = parser.parse_args()
    errors: list[str] = []
    # Contact sheets are optional human-review artifacts created outside this
    # validator. Never leave an older sheet beside freshly rendered pages,
    # because it can misrepresent the exact PDFs that just passed validation.
    if args.render_dir.exists():
        for stale_contact_sheet in args.render_dir.glob("*-contact-*.png"):
            stale_contact_sheet.unlink()
    expected = set(FILES)
    actual = exact_pdfs(args.publish_dir)
    if actual != expected:
        errors.append(f"published allowlist mismatch: expected {sorted(expected)}, found {sorted(actual)}")
    missing_output = expected - exact_pdfs(args.output_dir)
    if missing_output:
        errors.append(f"build output is missing: {sorted(missing_output)}")
    for name, pages in FILES.items():
        built = args.output_dir / name
        public = args.publish_dir / name
        if not built.is_file() or not public.is_file():
            continue
        if digest(built) != digest(public):
            errors.append(f"{name}: published bytes differ from build output")
        if args.compare_dir and digest(built) != digest(args.compare_dir / name):
            errors.append(f"{name}: deterministic rebuild hash mismatch")
        errors.extend(validate_pdf(public, pages, args.render_dir))
    if errors:
        print("Manual validation failed:")
        for error in errors:
            print(f"- {error}")
        return 1
    print("Validated exact four-file allowlist")
    for name in FILES:
        print(f"{name}  sha256={digest(args.publish_dir / name)}  pages={FILES[name]}")
    print(f"Rendered every page to {args.render_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
