#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "arabic-reshaper>=3.0.0",
#   "pillow>=10.0.0",
#   "python-bidi>=0.6.0",
#   "reportlab>=4.0.0",
# ]
# ///
"""Generate Axora's four production user manuals.

Run from any directory:

    uv run /srv/axora/scripts/manuals/generate_user_manuals.py

The manuals use real browser screenshots from ``output/playwright/manuals``.
During drafting, a polished browser-shaped placeholder is shown when an image
is missing. Use ``--require-screenshots`` for a final build that must contain
every screenshot in the manifest.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

try:
    import arabic_reshaper
    from bidi.algorithm import get_display
    from PIL import Image, ImageOps
    from reportlab.lib.colors import Color, HexColor, white
    from reportlab.lib.pagesizes import A4, landscape
    from reportlab.lib.utils import ImageReader
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas
except ImportError as exc:  # pragma: no cover - actionable local fallback
    raise SystemExit(
        "Missing PDF dependencies. Run this file with: "
        "uv run scripts/manuals/generate_user_manuals.py"
    ) from exc


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SCREENSHOT_DIR = REPO_ROOT / "output" / "playwright" / "manuals"
DEFAULT_OUTPUT_DIR = REPO_ROOT / "output" / "pdf"

PAGE_W, PAGE_H = landscape(A4)

NAVY = HexColor("#0B1F3A")
NAVY_2 = HexColor("#12345A")
TEAL = HexColor("#0B8C86")
TEAL_DARK = HexColor("#086A66")
MINT = HexColor("#DDF5EF")
BLUE = HexColor("#2878D0")
BLUE_LIGHT = HexColor("#E9F2FD")
GOLD = HexColor("#F2B84B")
GOLD_LIGHT = HexColor("#FFF4D8")
CORAL = HexColor("#EF6D5B")
INK = HexColor("#17243A")
SLATE = HexColor("#53657A")
MUTED = HexColor("#7B8B9F")
BORDER = HexColor("#DDE4EC")
PAPER = HexColor("#F4F7FA")
PALE = HexColor("#F8FAFC")

FONT_REG = "AxoraSans"
FONT_BOLD = "AxoraSansBold"
FONT_ITALIC = "AxoraSansItalic"
FONT_AR = "AxoraArabic"
FONT_AR_BOLD = "AxoraArabicBold"
FONT_AR_TITLE = "AxoraKufiBold"


@dataclass(frozen=True)
class Shot:
    filename: str
    caption_en: str
    caption_ar: str
    markers: tuple[tuple[int, float, float], ...] = ()


@dataclass(frozen=True)
class Page:
    kicker: str
    title: str
    subtitle: str
    steps: tuple[tuple[str, str], ...]
    shots: tuple[Shot, ...] = ()
    note: tuple[str, str] | None = None
    flow: tuple[str, ...] = ()


@dataclass(frozen=True)
class Manual:
    audience: str
    language: str
    filename: str
    cover_title: str
    cover_subtitle: str
    cover_audience: str
    cover_model: str
    cover_note: str
    cover_shot: Shot
    cover_flow: tuple[str, ...]
    pages: tuple[Page, ...]


SHOTS: dict[str, Shot] = {
    # Company screenshots
    "company-dashboard.png": Shot(
        "company-dashboard.png",
        "Company dashboard: requests, approvals and branch budget at a glance",
        "لوحة الشركة: الطلبات والاعتمادات وميزانية الفرع في مكان واحد",
        ((1, 0.20, 0.73), (2, 0.51, 0.73), (3, 0.82, 0.73)),
    ),
    "company-branches.png": Shot(
        "company-branches.png",
        "Branches & budgets shows delivery scope and monthly controls",
        "تعرض صفحة الفروع والميزانيات نطاق التسليم والضوابط الشهرية",
        ((1, 0.20, 0.50), (2, 0.70, 0.50)),
    ),
    "company-branch-budget.png": Shot(
        "company-branch-budget.png",
        "Set the monthly limit and check committed and available amounts",
        "حدّد السقف الشهري وراجع المبلغ الملتزم به والمتبقي",
        ((3, 0.75, 0.49),),
    ),
    "company-users.png": Shot(
        "company-users.png",
        "Named accounts show each person's role and access scope",
        "توضح الحسابات المسماة دور كل شخص ونطاق وصوله",
        ((1, 0.48, 0.54), (2, 0.70, 0.54)),
    ),
    "company-user-create.png": Shot(
        "company-user-create.png",
        "Create an account with the smallest role and the correct branch",
        "أنشئ الحساب بأقل صلاحية لازمة وحدّد الفرع الصحيح",
        ((3, 0.63, 0.52), (4, 0.74, 0.52)),
    ),
    "company-catalog.png": Shot(
        "company-catalog.png",
        "The customer catalog shows product image, name and ordering details",
        "يعرض كتالوج العميل صورة المنتج واسمه وتفاصيل الطلب",
        ((1, 0.22, 0.45), (2, 0.50, 0.45), (3, 0.79, 0.45)),
    ),
    "company-catalog-search.png": Shot(
        "company-catalog-search.png",
        "Search by product name, code, category or brand",
        "ابحث باسم المنتج أو رمزه أو فئته أو علامته التجارية",
        ((4, 0.74, 0.77),),
    ),
    "company-request-form.png": Shot(
        "company-request-form.png",
        "Choose the branch, need date, priority and business reason",
        "اختر الفرع وتاريخ الحاجة والأولوية وسبب الشراء",
        ((1, 0.23, 0.70), (2, 0.49, 0.70), (3, 0.75, 0.70)),
    ),
    "company-request-review.png": Shot(
        "company-request-review.png",
        "Check quantities, estimated total and available budget before submission",
        "راجع الكميات والإجمالي التقديري والميزانية المتاحة قبل الإرسال",
        ((1, 0.32, 0.66), (2, 0.68, 0.66)),
    ),
    "company-approvals.png": Shot(
        "company-approvals.png",
        "Approvers see requester, items, total and branch budget",
        "يرى المعتمد مقدم الطلب والأصناف والإجمالي وميزانية الفرع",
        ((1, 0.25, 0.55), (2, 0.70, 0.55)),
    ),
    "company-approval-budget.png": Shot(
        "company-approval-budget.png",
        "Approve within budget or reject with a recorded reason",
        "اعتمد ضمن الميزانية أو ارفض مع تسجيل السبب",
        ((3, 0.53, 0.31),),
    ),
    "company-request-tracking.png": Shot(
        "company-request-tracking.png",
        "Follow the request timeline after company approval",
        "تابع المسار الزمني للطلب بعد اعتماد الشركة",
        ((1, 0.76, 0.50),),
    ),
    "company-documents.png": Shot(
        "company-documents.png",
        "Company users see only files shared with their company and access scope",
        "يرى مستخدمو الشركة الملفات المشتركة مع شركتهم وضمن نطاق وصولهم فقط",
        ((2, 0.55, 0.48),),
    ),
    # Owner screenshots
    "owner-dashboard.png": Shot(
        "owner-dashboard.png",
        "Owner dashboard: approved demand, operations and financial controls",
        "لوحة المالك: الطلبات المعتمدة والتشغيل والضوابط المالية",
        ((1, 0.21, 0.72), (2, 0.51, 0.72), (3, 0.80, 0.72)),
    ),
    "owner-companies.png": Shot(
        "owner-companies.png",
        "Customer company register and active status",
        "سجل الشركات العميلة وحالة التفعيل",
        ((1, 0.43, 0.52),),
    ),
    "owner-company-create.png": Shot(
        "owner-company-create.png",
        "Register the approved company and its billing contact",
        "سجّل الشركة المعتمدة وبيانات جهة اتصال الفوترة",
        ((2, 0.70, 0.55),),
    ),
    "owner-suppliers.png": Shot(
        "owner-suppliers.png",
        "The global supplier register is private to Axora owners",
        "سجل المورّدين العام خاص بمالكي أكسورا",
        ((1, 0.44, 0.50),),
    ),
    "owner-supplier-create.png": Shot(
        "owner-supplier-create.png",
        "Add real supplier contacts, coverage, lead time and terms",
        "أضف بيانات المورّد الفعلية ونطاقه ومدة التوريد وشروطه",
        ((2, 0.69, 0.50),),
    ),
    "owner-products.png": Shot(
        "owner-products.png",
        "Global products include private buying data and customer-facing details",
        "تشمل المنتجات العامة بيانات الشراء الخاصة والتفاصيل الظاهرة للعميل",
        ((1, 0.36, 0.50), (2, 0.67, 0.50)),
    ),
    "owner-product-create.png": Shot(
        "owner-product-create.png",
        "Create the product with searchable details, prices, MOQ and SLA",
        "أنشئ المنتج بتفاصيل قابلة للبحث والأسعار والحد الأدنى ومدة التسليم",
        ((3, 0.73, 0.48),),
    ),
    "owner-product-image-upload.png": Shot(
        "owner-product-image-upload.png",
        "Upload or replace the image and add concise alternative text",
        "ارفع الصورة أو استبدلها وأضف نصاً بديلاً مختصراً",
        ((1, 0.76, 0.47), (2, 0.76, 0.33)),
    ),
    "owner-product-catalog-result.png": Shot(
        "owner-product-catalog-result.png",
        "Verify the image, product name and customer price in the customer catalog",
        "تحقق من الصورة واسم المنتج وسعر العميل في كتالوج الشركة",
        ((3, 0.48, 0.48),),
    ),
    "owner-approved-requests.png": Shot(
        "owner-approved-requests.png",
        "Only company-approved demand moves into Axora verification",
        "تنتقل الطلبات المعتمدة من الشركة فقط إلى تحقق أكسورا",
        ((1, 0.60, 0.48),),
    ),
    "owner-sourcing.png": Shot(
        "owner-sourcing.png",
        "Compare quotations and record why the selected offer won",
        "قارن عروض الأسعار وسجّل سبب اختيار العرض الفائز",
        ((2, 0.36, 0.52), (3, 0.75, 0.52)),
    ),
    "owner-deliveries.png": Shot(
        "owner-deliveries.png",
        "Record delivery progress against the approved request lines",
        "سجّل تقدم التسليم على بنود الطلب المعتمد",
        ((1, 0.57, 0.50),),
    ),
    "owner-invoices.png": Shot(
        "owner-invoices.png",
        "Issue invoices and record COD evidence for reconciliation",
        "أصدر الفواتير وسجّل إثبات الدفع عند الاستلام للمطابقة",
        ((2, 0.52, 0.49),),
    ),
    "owner-document-visibility.png": Shot(
        "owner-document-visibility.png",
        "Choose Axora-only or customer-shared visibility for each file",
        "اختر لكل ملف بين خاص بأكسورا أو مشترك مع العميل",
        ((3, 0.57, 0.50),),
    ),
    "owner-audit.png": Shot(
        "owner-audit.png",
        "Audit history records important changes, actors and reasons",
        "يسجّل سجل التدقيق التغييرات المهمة والمنفذين والأسباب",
        ((4, 0.58, 0.50),),
    ),
}


SCREENSHOT_MANIFEST = {
    "company": [
        "company-dashboard.png",
        "company-branches.png",
        "company-branch-budget.png",
        "company-users.png",
        "company-user-create.png",
        "company-catalog.png",
        "company-catalog-search.png",
        "company-request-form.png",
        "company-request-review.png",
        "company-approvals.png",
        "company-approval-budget.png",
        "company-request-tracking.png",
        "company-documents.png",
    ],
    "owner": [
        "owner-dashboard.png",
        "owner-companies.png",
        "owner-company-create.png",
        "owner-suppliers.png",
        "owner-supplier-create.png",
        "owner-products.png",
        "owner-product-create.png",
        "owner-product-image-upload.png",
        "owner-product-catalog-result.png",
        "owner-approved-requests.png",
        "owner-sourcing.png",
        "owner-deliveries.png",
        "owner-invoices.png",
        "owner-document-visibility.png",
        "owner-audit.png",
    ],
}

# Browser capture names used by earlier QA passes. The final manifest above
# remains canonical, while these aliases keep draft and regeneration work
# resilient when an equivalent full-page capture already exists.
SCREENSHOT_ALIASES: dict[str, tuple[str, ...]] = {
    "company-branch-budget.png": ("company-branches.png",),
    "company-users.png": ("company-people.png",),
    "company-user-create.png": ("company-people.png",),
    "company-catalog-search.png": ("company-catalog.png",),
    "company-request-form.png": ("requester-new-request.png",),
    "company-request-review.png": ("requester-new-request.png",),
    "company-approvals.png": ("approver-queue.png",),
    "company-approval-budget.png": ("approver-queue.png",),
}


def shot(name: str) -> Shot:
    return SHOTS[name]


COMPANY_EN_PAGES = (
    Page(
        "FOUNDATION",
        "Set branches and monthly budgets",
        "A branch defines delivery scope. Its monthly budget controls approved purchasing.",
        (
            ("Open Branches & budgets", "Confirm the active branch, delivery address and contact before people begin ordering."),
            ("Set the monthly limit", "Only the company administrator changes a branch budget."),
            ("Read the three numbers", "Monthly budget is the limit, committed is this month's approved value, and available is what remains."),
            ("Know when budget moves", "Draft and pending requests do not commit budget. Approval commits the estimated total."),
        ),
        (shot("company-branches.png"), shot("company-branch-budget.png")),
        ("ONE OWNER", "The company administrator owns budgets. A branch administrator manages people for one assigned branch."),
        ("Branch", "Monthly limit", "Approved spend", "Available"),
    ),
    Page(
        "PEOPLE & ACCESS",
        "Create users and assign the right role",
        "Use named accounts. Role controls the action; branch assignment controls the location.",
        (
            ("Requester", "Assign to employees who choose catalog products and submit and follow only their own purchase requests."),
            ("Approver", "Assign to an authorised HR lead, manager, CEO or other person allowed to commit branch budget."),
            ("Branch administrator", "Manages requesters and approvers for one branch. Use this for a local office lead."),
            ("Company administrator", "Manages all branches, budgets and company users. Keep at least one active company administrator."),
        ),
        (shot("company-users.png"), shot("company-user-create.png")),
        ("SEPARATION OF DUTIES", "A requester cannot approve their own request. Give every branch another authorised approver."),
        ("Named account", "Smallest role", "Correct branch", "No sharing"),
    ),
    Page(
        "CATALOG",
        "Find products in the Axora catalog",
        "Employees order from a catalog maintained by Axora, not from supplier records.",
        (
            ("Start with the image and name", "Use the product photo and name to confirm that the item matches the need."),
            ("Search the catalog", "Search by product name, code, category or brand, then open the matching product."),
            ("Check ordering details", "Review customer price, unit, minimum quantity and delivery estimate."),
            ("Add to a request", "Select Add to request. Customers cannot create products or suppliers."),
        ),
        (shot("company-catalog.png"), shot("company-catalog-search.png")),
        ("PRIVATE SOURCING", "Supplier contacts, quotations and Axora buying cost are not shown to company users."),
        ("Image", "Name", "Search", "Add"),
    ),
    Page(
        "PURCHASE REQUEST",
        "Create a purchase request",
        "The signed-in person becomes the requester. Choose one branch and explain the business need.",
        (
            ("Choose the branch", "Use the branch where the goods will be delivered. Branch-scoped users remain in their assigned branch."),
            ("Describe the need", "Enter department, needed-by date, priority and a clear business justification."),
            ("Choose catalog items", "Add one or more products, then enter quantity and any optional size or specification."),
            ("Check the estimate", "The summary multiplies customer price by quantity and shows the estimated total."),
        ),
        (shot("company-request-form.png"),),
        ("BE SPECIFIC", "A useful justification helps the approver decide quickly and gives Axora clear fulfilment context."),
        ("Branch", "Need", "Items", "Estimate"),
    ),
    Page(
        "SUBMISSION",
        "Review and submit",
        "Check the request once more before it enters the company approval queue.",
        (
            ("Verify products and quantities", "Confirm every product, unit, quantity and optional specification."),
            ("Check the branch budget", "Read the available amount. The request does not use it until approval."),
            ("Check timing and reason", "Confirm the needed-by date, priority and business justification are accurate."),
            ("Submit for company approval", "The request is created as pending. It waits for an authorised person other than the requester."),
        ),
        (shot("company-request-review.png"), shot("company-dashboard.png")),
        ("BEFORE SUBMITTING", "The requester identity comes from the signed-in account. Do not use a shared login."),
        ("Review", "Budget", "Submit", "Pending"),
    ),
    Page(
        "APPROVAL",
        "Approve without self-approval",
        "The approver checks need, amount and budget before the purchase can reach Axora.",
        (
            ("Open Purchase request approvals", "Review the requester, branch, products, quantities, total, need date and priority."),
            ("Check the budget impact", "Compare available now with the projected balance after approval."),
            ("Record the decision", "Approve within budget, or reject with a reason. Over-budget approval is blocked."),
            ("Keep the roles separate", "A person cannot approve their own request. One final company decision is recorded."),
        ),
        (shot("company-approvals.png"), shot("company-approval-budget.png")),
        ("WHAT APPROVAL MEANS", "Approval commits the estimated total to this month's branch budget and releases the request to Axora."),
        ("Review", "Budget", "Decision", "Audit"),
    ),
    Page(
        "AFTER APPROVAL",
        "Track fulfilment, invoices and documents",
        "Axora verifies, sources and fulfils the approved request while the company follows progress.",
        (
            ("Track the request", "Requesters follow only their own requests. Approvers and administrators can follow the wider branch or company scope."),
            ("Check delivery and billing", "Company roles with access can review delivery progress, customer invoices and recorded COD receipts."),
            ("Use customer-visible documents", "Download files Axora shared with the linked company or upload allowed supporting evidence."),
            ("Know what stays private", "Supplier quotations, supplier invoices and Axora-only documents are never exposed to customer roles."),
        ),
        (shot("company-request-tracking.png"), shot("company-documents.png")),
        ("CASH ON DELIVERY", "Axora records payment evidence for reconciliation. The app does not process an online payment."),
        ("Approved", "Axora fulfilment", "Delivery", "Completion"),
    ),
    Page(
        "READY TO USE",
        "Company checklist",
        "Complete these controls before normal purchasing begins.",
        (
            ("Structure", "Every active branch has the correct delivery contact and, where required, a monthly budget."),
            ("People", "Every branch has named requesters and at least one different approver. No shared accounts."),
            ("Practice", "Submit one low-risk request and confirm approval, budget commitment and branch visibility."),
            ("Support", "When reporting a problem, include the request code, page, time, steps and a screenshot. Never send a password."),
        ),
        (shot("company-dashboard.png"),),
        ("RESPONSIBILITY BOUNDARY", "Your company controls branches, people, budgets, requests and approvals. Axora controls catalog, suppliers and fulfilment."),
        ("Set up", "Request", "Approve", "Track"),
    ),
)


OWNER_EN_PAGES = (
    Page(
        "CUSTOMER ONBOARDING",
        "Onboard a customer company",
        "Axora approves the company record and first structure; the customer owns its ongoing budget decisions.",
        (
            ("Register the company", "Enter the approved legal or trading name, main contact, billing details and payment terms."),
            ("Create the first branch", "Record the delivery address, contact and instructions before a request can use that location."),
            ("Create a named company administrator", "Assign the ADMIN role to the company, with company-wide scope."),
            ("Hand over responsibility", "The company administrator maintains its branches, budgets and people. Axora owners do not approve customer spend."),
        ),
        (shot("owner-companies.png"), shot("owner-company-create.png")),
        ("PROTECT ACCESS", "Never share an owner account. Keep Ashraf and Omar as named, protected platform owners."),
        ("Company", "Branch", "Company admin", "Handover"),
    ),
    Page(
        "PRIVATE SOURCING DATA",
        "Maintain the private supplier register",
        "Suppliers belong to Axora's global sourcing operation, not to customer companies.",
        (
            ("Search before adding", "Avoid duplicate supplier records. Deactivate an old record instead of deleting history."),
            ("Capture real details", "Enter contact, coverage, address, category, lead time, MOQ, main products and actual terms."),
            ("Keep it private", "Supplier contacts, terms, quotations and buying prices remain visible only to Axora owners."),
            ("Maintain status", "Only active supplier records are available for preferred supplier and quotation selection."),
        ),
        (shot("owner-suppliers.png"), shot("owner-supplier-create.png")),
        ("ONE GLOBAL REGISTER", "Maintain each supplier once for Axora. Customers select products, not suppliers."),
        ("Search", "Add", "Verify", "Activate"),
    ),
    Page(
        "GLOBAL CATALOG",
        "Create a global catalog product",
        "Axora owners create products once; active products are then available to approved customer companies.",
        (
            ("Search the product register", "Check name, code and category first to prevent a duplicate."),
            ("Enter customer-facing details", "Add a clear name, category, subcategory, brand, size, unit, packaging and description."),
            ("Enter ordering controls", "Set customer price, Axora buying cost, minimum quantity and delivery SLA."),
            ("Link sourcing data", "Choose a preferred supplier when known. Buying cost and supplier identity remain private."),
        ),
        (shot("owner-products.png"), shot("owner-product-create.png")),
        ("PUBLISHING RULE", "Customers see the image, searchable details and customer price. They do not see the supplier or Axora buying cost."),
        ("Search", "Describe", "Price", "Publish"),
    ),
    Page(
        "PRODUCT IMAGE",
        "Upload a clear product image",
        "The image and product name are the customer's quickest way to recognise the correct item.",
        (
            ("Choose a clean image", "Use a clear JPEG, PNG or WebP that shows the correct product without unrelated content."),
            ("Stay within the limit", "The source file can be up to 5 MB. Axora automatically prepares it for the catalog."),
            ("Write alternative text", "Describe the visible product briefly, for example: White A4 copy paper ream, 80gsm."),
            ("Upload or replace", "Add the image when creating a product, or replace it from the product register later."),
        ),
        (shot("owner-product-image-upload.png"), shot("owner-product-catalog-result.png")),
        ("IMAGE QUALITY", "Match image, name, unit and specification. A misleading image can cause the requester to choose the wrong item."),
        ("Choose", "Describe", "Upload", "Verify"),
    ),
    Page(
        "CUSTOMER VIEW",
        "Verify the customer catalog",
        "Review every new or changed product from the customer's point of view.",
        (
            ("Confirm the card", "The product card should show the correct image, name, customer price, unit, MOQ and SLA."),
            ("Test search", "Search using the name, code, category and brand that a requester is likely to use."),
            ("Check the privacy boundary", "The customer view must not show suppliers, quotations, buying cost or internal notes."),
            ("Maintain the record", "Replace an unclear image and deactivate outdated or duplicate products instead of deleting history."),
        ),
        (shot("owner-product-catalog-result.png"), shot("owner-products.png")),
        ("FINAL CHECK", "A product is useful only when a requester can recognise it, find it and understand how it is ordered."),
        ("See", "Search", "Protect", "Maintain"),
    ),
    Page(
        "APPROVED DEMAND",
        "Start sourcing only after approval",
        "The customer decides whether to spend; Axora decides how to source and fulfil.",
        (
            ("Wait for the company decision", "Do not source a New Request that is still pending. Owners cannot approve customer budgets."),
            ("Begin verification", "An approved request moves to Under Verification, then can move to Waiting for Quotation."),
            ("Capture comparable offers", "For each request line, record the real reference, unit price, fee, validity, MOQ and lead time."),
            ("Select with a reason", "Compare like with like. Selecting an offer records the buying price and moves the work into supplier assignment."),
        ),
        (shot("owner-approved-requests.png"), shot("owner-sourcing.png")),
        ("SEPARATION OF DUTIES", "The company approver authorises budget. The Axora owner records sourcing and fulfilment evidence."),
        ("Customer approval", "Verify", "Compare", "Select"),
    ),
    Page(
        "FULFILMENT & EVIDENCE",
        "Deliver, invoice and control documents",
        "Keep the operational record complete while exposing only customer-appropriate evidence.",
        (
            ("Record delivery progress", "Update the approved request lines as they are prepared, dispatched, partially delivered or delivered."),
            ("Record invoices and COD evidence", "Customer and supplier invoices remain separate. Wait for full delivery; COD entries record a numbered receipt, not an online payment."),
            ("Choose document visibility", "Use Axora only for supplier or internal evidence; explicitly share suitable files with the linked customer."),
            ("Close with evidence", "Complete the workflow only after delivery, customer invoicing and settlement are recorded."),
        ),
        (shot("owner-deliveries.png"), shot("owner-invoices.png"), shot("owner-document-visibility.png")),
        ("HARD PRIVACY RULE", "Supplier invoices are always Axora-only. Customer roles can see only customer-shared files in their access scope."),
        ("Deliver", "Invoice", "Share safely", "Complete"),
    ),
    Page(
        "OWNER CONTROL",
        "Owner checklist",
        "Use this list before onboarding companies or fulfilling live requests.",
        (
            ("Master data", "Company, branch, named company administrator, supplier and product records are active and accurate."),
            ("Catalog quality", "Every active product has recognisable details; important products have a clear image and alternative text."),
            ("Workflow control", "Customer approval exists before sourcing; quotation and document decisions include evidence and reasons."),
            ("Accountability", "Review audit history and exceptions. Never send passwords or use shared owner accounts."),
        ),
        (shot("owner-audit.png"), shot("owner-dashboard.png")),
        ("RESPONSIBILITY BOUNDARY", "Axora owns catalog, suppliers, sourcing, delivery and finance records. Customer companies own their people, budgets and approvals."),
        ("Onboard", "Publish", "Fulfil", "Audit"),
    ),
)


COMPANY_AR_PAGES = (
    Page(
        "الأساس",
        "إعداد الفروع والميزانيات الشهرية",
        "يحدد الفرع نطاق التسليم، وتضبط ميزانيته الشهرية قيمة المشتريات المعتمدة.",
        (
            ("افتح صفحة الفروع والميزانيات", "تحقق من أن الفرع نشط وأن عنوان التسليم وبيانات الاتصال صحيحة قبل بدء الطلبات."),
            ("حدّد السقف الشهري", "مدير الشركة فقط هو من يغيّر ميزانية الفرع."),
            ("افهم الأرقام الثلاثة", "الميزانية هي السقف، والمبلغ الملتزم به هو قيمة الطلبات المعتمدة هذا الشهر، والمتبقي هو المتاح."),
            ("اعرف متى تُحتسب الميزانية", "المسودات والطلبات المعلقة لا تخصم من الميزانية. يتم الالتزام بالمبلغ عند الاعتماد."),
        ),
        (shot("company-branches.png"), shot("company-branch-budget.png")),
        ("مسؤولية واضحة", "مدير الشركة يملك صلاحية الميزانيات، بينما يدير مدير الفرع الأشخاص في فرع واحد."),
        ("الفرع", "السقف الشهري", "المعتمد", "المتبقي"),
    ),
    Page(
        "الأشخاص والصلاحيات",
        "إنشاء المستخدمين وتعيين الدور المناسب",
        "استخدم حساباً مسمى لكل شخص. يحدد الدور الإجراء، ويحدد الفرع نطاق العمل.",
        (
            ("مقدم الطلب", "عيّنه للموظف الذي يختار منتجات الكتالوج ويرسل ويتابع طلبات الشراء الخاصة به فقط."),
            ("المعتمد", "عيّنه لمسؤول موارد بشرية أو مدير أو رئيس تنفيذي مخوّل باعتماد الصرف من ميزانية الفرع."),
            ("مدير الفرع", "يدير مقدمي الطلبات والمعتمدين في فرع واحد. يناسب مسؤول الموقع المحلي."),
            ("مدير الشركة", "يدير كل الفروع والميزانيات ومستخدمي الشركة. حافظ على مدير شركة نشط واحد على الأقل."),
        ),
        (shot("company-users.png"), shot("company-user-create.png")),
        ("فصل المهام", "لا يمكن لمقدم الطلب اعتماد طلبه. عيّن معتمداً آخر مخولاً لكل فرع."),
        ("حساب مسمى", "أقل صلاحية", "الفرع الصحيح", "دون مشاركة"),
    ),
    Page(
        "الكتالوج",
        "البحث عن المنتجات في كتالوج أكسورا",
        "يطلب الموظفون من كتالوج تديره أكسورا، وليس من سجلات المورّدين.",
        (
            ("ابدأ بالصورة والاسم", "استخدم صورة المنتج واسمه للتأكد من أن الصنف يطابق الحاجة."),
            ("ابحث في الكتالوج", "ابحث بالاسم أو الرمز أو الفئة أو العلامة التجارية، ثم اختر المنتج المطابق."),
            ("راجع تفاصيل الطلب", "تحقق من سعر العميل والوحدة والحد الأدنى للكمية ومدة التسليم المتوقعة."),
            ("أضف المنتج إلى الطلب", "اختر إضافة إلى الطلب. لا يستطيع مستخدمو الشركة إنشاء المنتجات أو المورّدين."),
        ),
        (shot("company-catalog.png"), shot("company-catalog-search.png")),
        ("بيانات توريد خاصة", "لا تظهر للشركة بيانات المورّدين أو عروض الأسعار أو تكلفة شراء أكسورا."),
        ("الصورة", "الاسم", "البحث", "الإضافة"),
    ),
    Page(
        "طلب الشراء",
        "إنشاء طلب شراء",
        "يصبح المستخدم المسجل دخوله هو مقدم الطلب. اختر فرعاً واحداً واشرح سبب الحاجة.",
        (
            ("اختر الفرع", "استخدم الفرع الذي ستصل إليه البضاعة. يبقى المستخدم المحدد بفرع داخل نطاق فرعه."),
            ("اشرح الحاجة", "أدخل القسم وتاريخ الحاجة والأولوية ومبرراً واضحاً للشراء."),
            ("اختر أصناف الكتالوج", "أضف منتجاً أو أكثر ثم أدخل الكمية وأي مقاس أو مواصفة اختيارية."),
            ("راجع الإجمالي التقديري", "يضرب الملخص سعر العميل في الكمية ويعرض الإجمالي التقديري."),
        ),
        (shot("company-request-form.png"),),
        ("اكتب بوضوح", "المبرر الجيد يساعد المعتمد على اتخاذ القرار سريعاً ويعطي أكسورا سياقاً واضحاً للتنفيذ."),
        ("الفرع", "الحاجة", "الأصناف", "الإجمالي"),
    ),
    Page(
        "الإرسال",
        "مراجعة الطلب وإرساله",
        "راجع الطلب مرة أخيرة قبل دخوله قائمة اعتماد الشركة.",
        (
            ("تحقق من المنتجات والكميات", "راجع كل منتج ووحدته وكميته وأي مواصفة اختيارية."),
            ("راجع ميزانية الفرع", "اقرأ المبلغ المتاح. لا يستخدم الطلب الميزانية إلا بعد الاعتماد."),
            ("تحقق من الوقت والسبب", "تأكد من صحة تاريخ الحاجة والأولوية ومبرر الشراء."),
            ("أرسل للاعتماد", "يُنشأ الطلب بحالة معلقة وينتظر شخصاً مخولاً غير مقدم الطلب."),
        ),
        (shot("company-request-review.png"), shot("company-dashboard.png")),
        ("قبل الإرسال", "تأتي هوية مقدم الطلب من الحساب المسجل دخوله. لا تستخدم حساباً مشتركاً."),
        ("مراجعة", "ميزانية", "إرسال", "معلق"),
    ),
    Page(
        "الاعتماد",
        "اعتماد الطلب دون اعتماد ذاتي",
        "يتحقق المعتمد من الحاجة والقيمة والميزانية قبل وصول الطلب إلى أكسورا.",
        (
            ("افتح صفحة اعتمادات طلبات الشراء", "راجع مقدم الطلب والفرع والمنتجات والكميات والإجمالي وتاريخ الحاجة والأولوية."),
            ("راجع أثر الطلب على الميزانية", "قارن المتاح الآن بالرصيد المتوقع بعد الاعتماد."),
            ("سجّل القرار", "اعتمد ضمن الميزانية أو ارفض مع السبب. يمنع النظام اعتماد طلب يتجاوز الميزانية."),
            ("افصل بين الدورين", "لا يمكن للشخص اعتماد طلبه. يُسجّل قرار نهائي واحد للشركة."),
        ),
        (shot("company-approvals.png"), shot("company-approval-budget.png")),
        ("معنى الاعتماد", "يلتزم الإجمالي التقديري من ميزانية الفرع لهذا الشهر وينتقل الطلب إلى أكسورا."),
        ("مراجعة", "ميزانية", "قرار", "تدقيق"),
    ),
    Page(
        "بعد الاعتماد",
        "متابعة التنفيذ والفواتير والمستندات",
        "تتحقق أكسورا من الطلب المعتمد وتورّده وتنفذه، بينما تتابع الشركة التقدم.",
        (
            ("تابع الطلب", "استخدم تفاصيل الطلب والمسار الزمني لمتابعة التحقق والتوريد والطلب والتسليم."),
            ("راجع التسليم والفوترة", "يمكن للأدوار المخولة مراجعة تقدم التسليم وفواتير العميل وإيصالات الدفع عند الاستلام المسجلة."),
            ("استخدم المستندات المشتركة", "نزّل الملفات التي شاركتها أكسورا مع الشركة أو ارفع أدلة داعمة مسموحاً بها."),
            ("اعرف ما يبقى خاصاً", "لا تظهر للعميل عروض المورّدين أو فواتيرهم أو مستندات أكسورا الداخلية."),
        ),
        (shot("company-request-tracking.png"), shot("company-documents.png")),
        ("الدفع عند الاستلام", "تسجّل أكسورا دليل الدفع للمطابقة، ولا يعالج التطبيق دفعاً إلكترونياً."),
        ("معتمد", "تنفيذ أكسورا", "تسليم", "إكمال"),
    ),
    Page(
        "الجاهزية",
        "قائمة جاهزية الشركة",
        "أكمل هذه الضوابط قبل بدء المشتريات المعتادة.",
        (
            ("الهيكل", "لكل فرع نشط جهة اتصال وتسليم صحيحة وميزانية شهرية عند الحاجة."),
            ("الأشخاص", "لكل فرع مقدمو طلبات مسمّون ومعتمد مختلف واحد على الأقل. لا توجد حسابات مشتركة."),
            ("التجربة", "أرسل طلباً منخفض المخاطر وتحقق من الاعتماد والالتزام بالميزانية ونطاق الفرع."),
            ("الدعم", "عند الإبلاغ عن مشكلة أرسل رمز الطلب والصفحة والوقت والخطوات وصورة للشاشة. لا ترسل كلمة المرور."),
        ),
        (shot("company-dashboard.png"),),
        ("حدود المسؤولية", "تتحكم شركتك في الفروع والأشخاص والميزانيات والطلبات والاعتمادات، وتتحكم أكسورا في الكتالوج والمورّدين والتنفيذ."),
        ("إعداد", "طلب", "اعتماد", "متابعة"),
    ),
)


OWNER_AR_PAGES = (
    Page(
        "تهيئة العميل",
        "تهيئة شركة عميلة جديدة",
        "تعتمد أكسورا سجل الشركة وبنيتها الأولى، وتملك الشركة قرارات ميزانيتها المستمرة.",
        (
            ("سجّل الشركة", "أدخل الاسم التجاري أو القانوني المعتمد وبيانات الاتصال والفوترة وشروط الدفع."),
            ("أنشئ الفرع الأول", "سجّل عنوان التسليم وجهة الاتصال والتعليمات قبل استخدام الموقع في أي طلب."),
            ("أنشئ مدير شركة مسمى", "عيّن دور مدير الشركة للحساب واربطه بالشركة بصلاحية تشمل الشركة كلها."),
            ("سلّم المسؤولية", "يدير مدير الشركة فروعها وميزانياتها وأشخاصها. لا يعتمد مالك أكسورا صرف العميل."),
        ),
        (shot("owner-companies.png"), shot("owner-company-create.png")),
        ("احمِ الوصول", "لا تشارك حساب المالك. احتفظ بأشرف وعمر كمالكي منصة مسمّيين ومحميين."),
        ("شركة", "فرع", "مدير الشركة", "تسليم"),
    ),
    Page(
        "بيانات التوريد الخاصة",
        "إدارة سجل المورّدين الخاص",
        "المورّدون جزء من تشغيل أكسورا العام للتوريد، وليسوا سجلات تديرها الشركات العميلة.",
        (
            ("ابحث قبل الإضافة", "تجنب تكرار سجل المورّد. عطّل السجل القديم بدلاً من حذف تاريخه."),
            ("سجّل البيانات الفعلية", "أدخل جهة الاتصال والتغطية والعنوان والفئة ومدة التوريد والحد الأدنى والمنتجات والشروط."),
            ("حافظ على الخصوصية", "تبقى جهات الاتصال والشروط وعروض الأسعار وتكاليف الشراء ظاهرة لمالكي أكسورا فقط."),
            ("حافظ على الحالة", "لا تتاح لاختيار المورّد المفضل أو عروض الأسعار إلا سجلات المورّدين النشطة."),
        ),
        (shot("owner-suppliers.png"), shot("owner-supplier-create.png")),
        ("سجل عام واحد", "حافظ على كل مورّد مرة واحدة لأكسورا. يختار العميل المنتجات ولا يختار المورّد."),
        ("بحث", "إضافة", "تحقق", "تفعيل"),
    ),
    Page(
        "الكتالوج العام",
        "إنشاء منتج في الكتالوج العام",
        "ينشئ مالك أكسورا المنتج مرة واحدة، ثم يتاح المنتج النشط للشركات العميلة المعتمدة.",
        (
            ("ابحث في سجل المنتجات", "تحقق من الاسم والرمز والفئة أولاً لمنع التكرار."),
            ("أدخل التفاصيل الظاهرة للعميل", "أضف اسماً واضحاً وفئة وفئة فرعية وعلامة ومقاساً ووحدة وتعبئة ووصفاً."),
            ("أدخل ضوابط الطلب", "حدّد سعر العميل وتكلفة شراء أكسورا والحد الأدنى للكمية ومدة التسليم."),
            ("اربط بيانات التوريد", "اختر المورّد المفضل إن كان معروفاً. تبقى التكلفة وهوية المورّد خاصتين."),
        ),
        (shot("owner-products.png"), shot("owner-product-create.png")),
        ("قاعدة النشر", "يرى العميل الصورة والتفاصيل القابلة للبحث وسعره، ولا يرى المورّد أو تكلفة شراء أكسورا."),
        ("بحث", "وصف", "تسعير", "نشر"),
    ),
    Page(
        "صورة المنتج",
        "رفع صورة واضحة للمنتج",
        "الصورة واسم المنتج هما أسرع وسيلة ليتعرف العميل على الصنف الصحيح.",
        (
            ("اختر صورة نظيفة", "استخدم صورة واضحة بصيغة JPEG أو PNG أو WebP تعرض المنتج الصحيح دون محتوى غير متعلق."),
            ("التزم بالحجم", "يمكن أن يصل الملف الأصلي إلى 5 ميغابايت، وتجهزه أكسورا تلقائياً للكتالوج."),
            ("اكتب نصاً بديلاً", "صف المنتج الظاهر باختصار، مثل: رزمة ورق تصوير أبيض A4 بوزن 80 غراماً."),
            ("ارفع الصورة أو استبدلها", "أضفها عند إنشاء المنتج أو استبدلها لاحقاً من سجل المنتجات."),
        ),
        (shot("owner-product-image-upload.png"), shot("owner-product-catalog-result.png")),
        ("جودة الصورة", "طابق الصورة مع الاسم والوحدة والمواصفة. قد تدفع الصورة المضللة مقدم الطلب إلى اختيار صنف خاطئ."),
        ("اختيار", "وصف", "رفع", "تحقق"),
    ),
    Page(
        "واجهة العميل",
        "التحقق من ظهور المنتج للعميل",
        "راجع كل منتج جديد أو معدل من وجهة نظر الشركة العميلة.",
        (
            ("تحقق من بطاقة المنتج", "يجب أن تعرض الصورة والاسم وسعر العميل والوحدة والحد الأدنى ومدة التسليم الصحيحة."),
            ("اختبر البحث", "ابحث بالاسم والرمز والفئة والعلامة التي يرجح أن يستخدمها مقدم الطلب."),
            ("تحقق من حدود الخصوصية", "يجب ألا تعرض واجهة العميل المورّدين أو عروض الأسعار أو تكلفة الشراء أو الملاحظات الداخلية."),
            ("حافظ على السجل", "استبدل الصورة غير الواضحة وعطّل المنتج القديم أو المكرر بدلاً من حذف التاريخ."),
        ),
        (shot("owner-product-catalog-result.png"), shot("owner-products.png")),
        ("التحقق النهائي", "يكون المنتج مفيداً عندما يستطيع مقدم الطلب التعرف عليه والعثور عليه وفهم طريقة طلبه."),
        ("رؤية", "بحث", "حماية", "صيانة"),
    ),
    Page(
        "الطلب المعتمد",
        "بدء التوريد بعد اعتماد العميل فقط",
        "تقرر الشركة هل تصرف الميزانية، وتقرر أكسورا كيف تورّد وتنفذ.",
        (
            ("انتظر قرار الشركة", "لا تبدأ توريد طلب جديد ما زال معلقاً. لا يستطيع مالك أكسورا اعتماد ميزانية العميل."),
            ("ابدأ التحقق", "ينتقل الطلب المعتمد إلى قيد التحقق ثم يمكن نقله إلى انتظار عرض السعر."),
            ("سجّل عروضاً قابلة للمقارنة", "سجّل لكل بند المرجع الفعلي وسعر الوحدة والرسوم والصلاحية والحد الأدنى ومدة التوريد."),
            ("اختر مع تسجيل السبب", "قارن نفس المواصفة. يسجّل اختيار العرض سعر الشراء وينقل العمل إلى تعيين المورّد."),
        ),
        (shot("owner-approved-requests.png"), shot("owner-sourcing.png")),
        ("فصل المهام", "يعتمد مسؤول الشركة الميزانية، ويسجّل مالك أكسورا أدلة التوريد والتنفيذ."),
        ("اعتماد العميل", "تحقق", "مقارنة", "اختيار"),
    ),
    Page(
        "التنفيذ والأدلة",
        "التسليم والفوترة وضبط المستندات",
        "حافظ على سجل تشغيلي مكتمل ولا تعرض للعميل إلا الأدلة المناسبة.",
        (
            ("سجّل تقدم التسليم", "حدّث بنود الطلب المعتمد عند التجهيز أو الخروج للتسليم أو التسليم الجزئي أو الكامل."),
            ("سجّل الفواتير وإثبات الدفع", "افصل فاتورة العميل عن فاتورة المورّد. انتظر اكتمال التسليم، ثم سجّل مرجع الإيصال المرقّم كدليل وليس كدفع إلكتروني."),
            ("اختر رؤية المستند", "استخدم خاص بأكسورا لأدلة المورّد أو الأدلة الداخلية، وشارك الملفات المناسبة صراحة مع العميل المرتبط."),
            ("أغلق مع وجود الدليل", "أكمل المسار بعد تسجيل التسليم وفاتورة العميل والتسوية."),
        ),
        (shot("owner-deliveries.png"), shot("owner-invoices.png"), shot("owner-document-visibility.png")),
        ("قاعدة خصوصية صارمة", "تظل فواتير المورّد خاصة بأكسورا دائماً. لا يرى العميل إلا الملفات المشتركة معه ضمن نطاقه."),
        ("تسليم", "فوترة", "مشاركة آمنة", "إكمال"),
    ),
    Page(
        "ضوابط المالك",
        "قائمة ضوابط مالك المنصة",
        "استخدم هذه القائمة قبل تهيئة الشركات أو تنفيذ الطلبات الفعلية.",
        (
            ("البيانات الأساسية", "الشركة والفرع ومدير الشركة والمورّد والمنتج سجلات نشطة ودقيقة."),
            ("جودة الكتالوج", "لكل منتج نشط تفاصيل واضحة، وللمنتجات المهمة صورة واضحة ونص بديل."),
            ("ضبط المسار", "يوجد اعتماد العميل قبل التوريد، وتتضمن قرارات عرض السعر والمستندات الأدلة والأسباب."),
            ("المساءلة", "راجع سجل التدقيق والاستثناءات. لا ترسل كلمات المرور ولا تستخدم حساب مالك مشتركاً."),
        ),
        (shot("owner-audit.png"), shot("owner-dashboard.png")),
        ("حدود المسؤولية", "تملك أكسورا الكتالوج والمورّدين والتوريد والتسليم وسجلات المالية، وتملك الشركات أشخاصها وميزانياتها واعتماداتها."),
        ("تهيئة", "نشر", "تنفيذ", "تدقيق"),
    ),
)


MANUALS = (
    Manual(
        "company",
        "en",
        "axora-company-user-manual-en.pdf",
        "Company purchasing manual",
        "Control requests, approvals and branch budgets",
        "For company administrators, branch administrators, approvers and requesters",
        "Your company controls people, branches, budgets, requests and approvals. Axora controls products, suppliers and fulfilment.",
        "Production workflow - use named accounts and real business records",
        shot("company-dashboard.png"),
        ("Set up", "Request", "Approve", "Axora fulfils"),
        COMPANY_EN_PAGES,
    ),
    Manual(
        "company",
        "ar",
        "axora-company-user-manual-ar.pdf",
        "دليل مشتريات الشركة",
        "إدارة الطلبات والاعتمادات وميزانيات الفروع",
        "لمدير الشركة ومدير الفرع والمعتمد ومقدم الطلب",
        "تتحكم شركتك في الأشخاص والفروع والميزانيات والطلبات والاعتمادات، وتتحكم أكسورا في المنتجات والمورّدين والتنفيذ.",
        "مسار تشغيلي فعلي - استخدم حسابات مسماة وسجلات عمل حقيقية",
        shot("company-dashboard.png"),
        ("إعداد", "طلب", "اعتماد", "تنفيذ أكسورا"),
        COMPANY_AR_PAGES,
    ),
    Manual(
        "owner",
        "en",
        "axora-owner-admin-manual-en.pdf",
        "Platform owner operations manual",
        "Run the catalog, supplier network and fulfilment safely",
        "For Ashraf and Omar - Axora platform owners",
        "Axora owners manage customer onboarding, the global catalog, private suppliers, sourcing, delivery and operational finance. Customer companies own their people, budgets and approvals.",
        "Production owner guide - supplier and buying data stay private",
        shot("owner-dashboard.png"),
        ("Onboard", "Publish", "Wait for approval", "Fulfil"),
        OWNER_EN_PAGES,
    ),
    Manual(
        "owner",
        "ar",
        "axora-owner-admin-manual-ar.pdf",
        "دليل تشغيل مالك منصة أكسورا",
        "إدارة الكتالوج والمورّدين والتنفيذ بأمان",
        "لأشرف وعمر - مالكي منصة أكسورا",
        "يدير مالكو أكسورا تهيئة العملاء والكتالوج العام والمورّدين الخاصين والتوريد والتسليم والسجلات المالية التشغيلية، بينما تملك الشركات أشخاصها وميزانياتها واعتماداتها.",
        "دليل تشغيل فعلي - تبقى بيانات المورّدين وتكلفة الشراء خاصة",
        shot("owner-dashboard.png"),
        ("تهيئة", "نشر", "انتظار الاعتماد", "تنفيذ"),
        OWNER_AR_PAGES,
    ),
)


def register_fonts() -> None:
    candidates = {
        FONT_REG: Path("/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf"),
        FONT_BOLD: Path("/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf"),
        FONT_ITALIC: Path("/usr/share/fonts/truetype/noto/NotoSans-Italic.ttf"),
        FONT_AR: Path("/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf"),
        FONT_AR_BOLD: Path("/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf"),
        FONT_AR_TITLE: Path("/usr/share/fonts/truetype/noto/NotoKufiArabic-Bold.ttf"),
    }
    missing = [str(path) for path in candidates.values() if not path.exists()]
    if missing:
        raise SystemExit("Required Noto font files are missing:\n" + "\n".join(missing))
    for name, path in candidates.items():
        pdfmetrics.registerFont(TTFont(name, str(path)))


def is_rtl(language: str) -> bool:
    return language == "ar"


def visual(text: str, rtl: bool) -> str:
    if not rtl:
        return text
    reshaped = arabic_reshaper.reshape(text)
    return get_display(reshaped, base_dir="R")


def font_name(*, rtl: bool, bold: bool = False, title: bool = False) -> str:
    if rtl:
        # Noto Sans Arabic contains the Arabic presentation forms emitted by
        # arabic-reshaper. Some distro builds of Noto Kufi omit those forms,
        # which can make shaped title glyphs disappear in PDF viewers.
        if title:
            return FONT_AR_BOLD
        return FONT_AR_BOLD if bold else FONT_AR
    return FONT_BOLD if bold else FONT_REG


def string_width(text: str, font: str, size: float, rtl: bool) -> float:
    return pdfmetrics.stringWidth(visual(text, rtl), font, size)


def wrap_lines(text: str, font: str, size: float, width: float, rtl: bool) -> list[str]:
    paragraphs = text.splitlines() or [""]
    result: list[str] = []
    for paragraph in paragraphs:
        words = paragraph.split()
        if not words:
            result.append("")
            continue
        current = words[0]
        for word in words[1:]:
            candidate = f"{current} {word}"
            if string_width(candidate, font, size, rtl) <= width:
                current = candidate
            else:
                result.append(current)
                current = word
        result.append(current)
    return result


def draw_text(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    *,
    rtl: bool,
    font: str,
    size: float,
    color: Color = INK,
    align: str | None = None,
) -> None:
    c.setFont(font, size)
    c.setFillColor(color)
    rendered = visual(text, rtl)
    actual_align = align or ("right" if rtl else "left")
    if actual_align == "right":
        c.drawRightString(x, y, rendered)
    elif actual_align == "center":
        c.drawCentredString(x, y, rendered)
    else:
        c.drawString(x, y, rendered)


def draw_paragraph(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    *,
    rtl: bool,
    font: str,
    size: float,
    leading: float | None = None,
    color: Color = SLATE,
    max_lines: int | None = None,
) -> float:
    line_height = leading or size * 1.42
    lines = wrap_lines(text, font, size, width, rtl)
    if max_lines is not None and len(lines) > max_lines:
        lines = lines[:max_lines]
        if lines:
            lines[-1] = lines[-1].rstrip(".") + "..."
    cursor = y
    for line in lines:
        draw_text(
            c,
            line,
            x + width if rtl else x,
            cursor,
            rtl=rtl,
            font=font,
            size=size,
            color=color,
        )
        cursor -= line_height
    return cursor


def draw_logo(c: canvas.Canvas, x: float, y: float, *, dark: bool = False) -> None:
    c.setFillColor(MINT if dark else TEAL)
    c.circle(x + 13, y + 13, 13, fill=1, stroke=0)
    c.setStrokeColor(NAVY if not dark else white)
    c.setLineWidth(3)
    c.line(x + 7, y + 9, x + 13, y + 18)
    c.line(x + 13, y + 18, x + 20, y + 7)
    c.setFillColor(white if dark else NAVY)
    c.setFont(FONT_BOLD, 16)
    c.drawString(x + 34, y + 7, "AXORA")


def rounded_card(
    c: canvas.Canvas,
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    fill: Color = white,
    stroke: Color = BORDER,
    radius: float = 12,
    shadow: bool = True,
) -> None:
    if shadow:
        c.setFillColor(HexColor("#DCE3EA"))
        c.roundRect(x + 2, y - 3, w, h, radius, fill=1, stroke=0)
    c.setFillColor(fill)
    c.setStrokeColor(stroke)
    c.setLineWidth(0.8)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def draw_pill(
    c: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    *,
    rtl: bool,
    fill: Color = MINT,
    ink: Color = TEAL_DARK,
    width: float | None = None,
) -> float:
    font = font_name(rtl=rtl, bold=True)
    size = 7.5 if not rtl else 8
    measured = string_width(text, font, size, rtl) + 20
    w = max(width or measured, 50)
    c.setFillColor(fill)
    c.roundRect(x, y, w, 20, 10, fill=1, stroke=0)
    draw_text(
        c,
        text,
        x + w / 2,
        y + 6.2,
        rtl=rtl,
        font=font,
        size=size,
        color=ink,
        align="center",
    )
    return w


def _load_image(path: Path) -> tuple[ImageReader, int, int]:
    with Image.open(path) as source:
        image = ImageOps.exif_transpose(source).convert("RGB")
        copy = image.copy()
    return ImageReader(copy), copy.width, copy.height


def screenshot_path(screenshot_dir: Path, filename: str) -> Path | None:
    canonical = screenshot_dir / filename
    if canonical.exists():
        return canonical
    for alias in SCREENSHOT_ALIASES.get(filename, ()):
        candidate = screenshot_dir / alias
        if candidate.exists():
            return candidate
    return None


def draw_contained_image(
    c: canvas.Canvas,
    path: Path,
    x: float,
    y: float,
    w: float,
    h: float,
) -> tuple[float, float, float, float]:
    reader, pixel_w, pixel_h = _load_image(path)
    scale = min(w / pixel_w, h / pixel_h)
    draw_w = pixel_w * scale
    draw_h = pixel_h * scale
    draw_x = x + (w - draw_w) / 2
    draw_y = y + (h - draw_h) / 2
    c.drawImage(reader, draw_x, draw_y, draw_w, draw_h, preserveAspectRatio=True, mask="auto")
    return draw_x, draw_y, draw_w, draw_h


def draw_missing_screenshot(
    c: canvas.Canvas,
    filename: str,
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    rtl: bool,
) -> tuple[float, float, float, float]:
    c.setFillColor(PALE)
    c.rect(x, y, w, h, fill=1, stroke=0)
    c.setFillColor(NAVY)
    c.rect(x, y + h - 20, w, 20, fill=1, stroke=0)
    for index, color in enumerate((CORAL, GOLD, TEAL)):
        c.setFillColor(color)
        c.circle(x + 12 + index * 13, y + h - 10, 3.5, fill=1, stroke=0)
    c.setFillColor(HexColor("#E7EDF4"))
    c.rect(x, y, w * 0.18, h - 20, fill=1, stroke=0)
    c.setFillColor(white)
    for row in range(5):
        c.roundRect(x + 8, y + h - 43 - row * 24, w * 0.18 - 16, 12, 4, fill=1, stroke=0)
    c.setStrokeColor(BORDER)
    c.setDash(4, 4)
    c.roundRect(x + w * 0.23, y + 18, w * 0.72, h - 55, 8, fill=0, stroke=1)
    c.setDash()
    label = "Screenshot pending" if not rtl else "صورة الشاشة قيد الإضافة"
    draw_text(
        c,
        label,
        x + w * 0.59,
        y + h * 0.55,
        rtl=rtl,
        font=font_name(rtl=rtl, bold=True),
        size=10,
        color=SLATE,
        align="center",
    )
    draw_text(
        c,
        filename,
        x + w * 0.59,
        y + h * 0.44,
        rtl=False,
        font=FONT_REG,
        size=7,
        color=MUTED,
        align="center",
    )
    return x, y, w, h


def draw_marker(
    c: canvas.Canvas,
    number: int,
    x: float,
    y: float,
    radius: float = 10,
) -> None:
    c.setFillColor(GOLD)
    c.setStrokeColor(white)
    c.setLineWidth(2)
    c.circle(x, y, radius, fill=1, stroke=1)
    draw_text(
        c,
        str(number),
        x,
        y - 3.2,
        rtl=False,
        font=FONT_BOLD,
        size=8.5,
        color=NAVY,
        align="center",
    )


def draw_screenshot(
    c: canvas.Canvas,
    item: Shot,
    screenshot_dir: Path,
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    rtl: bool,
) -> None:
    rounded_card(c, x, y, w, h, radius=10, shadow=True)
    chrome_h = 18
    c.setFillColor(NAVY)
    c.roundRect(x, y + h - chrome_h, w, chrome_h, 10, fill=1, stroke=0)
    c.rect(x, y + h - chrome_h, w, chrome_h / 2, fill=1, stroke=0)
    for index, color in enumerate((CORAL, GOLD, TEAL)):
        c.setFillColor(color)
        c.circle(x + 11 + index * 12, y + h - 9, 3, fill=1, stroke=0)

    caption_h = 31
    image_x = x + 5
    image_y = y + caption_h + 3
    image_w = w - 10
    image_h = h - chrome_h - caption_h - 7
    path = screenshot_path(screenshot_dir, item.filename)
    if path is not None:
        rendered = draw_contained_image(c, path, image_x, image_y, image_w, image_h)
    else:
        rendered = draw_missing_screenshot(c, item.filename, image_x, image_y, image_w, image_h, rtl=rtl)

    for number, fraction_x, fraction_y in item.markers:
        rx, ry, rw, rh = rendered
        draw_marker(c, number, rx + rw * fraction_x, ry + rh * fraction_y, radius=8 if h < 190 else 9)

    caption = item.caption_ar if rtl else item.caption_en
    draw_paragraph(
        c,
        caption,
        x + 10,
        y + 20,
        w - 20,
        rtl=rtl,
        font=font_name(rtl=rtl),
        size=6.8 if not rtl else 7.3,
        leading=8.5,
        color=SLATE,
        max_lines=2,
    )


def draw_flow(
    c: canvas.Canvas,
    labels: Sequence[str],
    x: float,
    y: float,
    w: float,
    *,
    rtl: bool,
    dark: bool = False,
) -> None:
    if not labels:
        return
    count = len(labels)
    gap = 8
    item_w = (w - gap * (count - 1)) / count
    ordered = list(reversed(labels)) if rtl else list(labels)
    for index, label in enumerate(ordered):
        bx = x + index * (item_w + gap)
        fill = Color(1, 1, 1, alpha=0.11) if dark else BLUE_LIGHT
        c.setFillColor(fill)
        c.roundRect(bx, y, item_w, 34, 8, fill=1, stroke=0)
        circle_x = bx + item_w - 17 if rtl else bx + 17
        c.setFillColor(GOLD if index == count - 1 else TEAL)
        c.circle(circle_x, y + 17, 9, fill=1, stroke=0)
        display_number = count - index if rtl else index + 1
        draw_text(
            c,
            str(display_number),
            circle_x,
            y + 14,
            rtl=False,
            font=FONT_BOLD,
            size=7,
            color=NAVY,
            align="center",
        )
        tx = bx + item_w - 32 if rtl else bx + 32
        tw = item_w - 40
        draw_paragraph(
            c,
            label,
            bx + 8 if rtl else tx,
            y + 20,
            tw,
            rtl=rtl,
            font=font_name(rtl=rtl, bold=True),
            size=6.8 if not rtl else 7.2,
            leading=8,
            color=white if dark else NAVY,
            max_lines=2,
        )
        if index < count - 1:
            c.setStrokeColor(GOLD if dark else TEAL)
            c.setLineWidth(1.5)
            start = bx + item_w + 1
            c.line(start, y + 17, start + gap - 2, y + 17)


def draw_cover(c: canvas.Canvas, manual: Manual, screenshot_dir: Path) -> None:
    rtl = is_rtl(manual.language)
    c.setFillColor(NAVY)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(NAVY_2)
    c.circle(PAGE_W - 30, PAGE_H + 25, 180, fill=1, stroke=0)
    c.setFillColor(TEAL_DARK)
    c.circle(PAGE_W - 5, -20, 120, fill=1, stroke=0)
    c.setStrokeColor(Color(1, 1, 1, alpha=0.08))
    c.setLineWidth(1)
    for offset in range(-80, 440, 28):
        c.line(420 + offset, 80, 660 + offset, 520)

    draw_logo(c, 42, PAGE_H - 62, dark=True)
    draw_pill(
        c,
        "COMPANY GUIDE" if manual.audience == "company" and not rtl
        else "OWNER GUIDE" if not rtl
        else "دليل الشركة" if manual.audience == "company"
        else "دليل المالك",
        42 if not rtl else 250,
        PAGE_H - 112,
        rtl=rtl,
        fill=GOLD_LIGHT,
        ink=NAVY,
        width=126,
    )

    title_x = 42
    title_w = 335
    title_y = PAGE_H - 160
    title_font = font_name(rtl=rtl, bold=True, title=rtl)
    title_size = 28 if not rtl else 25
    title_y = draw_paragraph(
        c,
        manual.cover_title,
        title_x,
        title_y,
        title_w,
        rtl=rtl,
        font=title_font,
        size=title_size,
        leading=38,
        color=white,
        max_lines=3,
    )
    title_y -= 7
    title_y = draw_paragraph(
        c,
        manual.cover_subtitle,
        title_x,
        title_y,
        title_w,
        rtl=rtl,
        font=font_name(rtl=rtl, bold=True),
        size=12 if not rtl else 13,
        leading=18,
        color=GOLD,
        max_lines=3,
    )
    title_y -= 14
    title_y = draw_paragraph(
        c,
        manual.cover_audience,
        title_x,
        title_y,
        title_w,
        rtl=rtl,
        font=font_name(rtl=rtl),
        size=9 if not rtl else 10,
        leading=14,
        color=HexColor("#D9E4F0"),
        max_lines=3,
    )

    model_y = 133
    c.setFillColor(Color(1, 1, 1, alpha=0.08))
    c.roundRect(42, model_y, 335, 100, 12, fill=1, stroke=0)
    draw_text(
        c,
        "THE OPERATING MODEL" if not rtl else "نموذج التشغيل",
        360 if rtl else 58,
        model_y + 75,
        rtl=rtl,
        font=font_name(rtl=rtl, bold=True),
        size=7.5 if not rtl else 8.5,
        color=GOLD,
    )
    draw_paragraph(
        c,
        manual.cover_model,
        58,
        model_y + 54,
        303,
        rtl=rtl,
        font=font_name(rtl=rtl),
        size=8 if not rtl else 8.8,
        leading=12.5,
        color=white,
        max_lines=5,
    )

    draw_screenshot(
        c,
        manual.cover_shot,
        screenshot_dir,
        420,
        143,
        374,
        300,
        rtl=rtl,
    )
    draw_flow(c, manual.cover_flow, 420, 91, 374, rtl=rtl, dark=True)
    draw_text(
        c,
        manual.cover_note,
        42 if not rtl else 377,
        62,
        rtl=rtl,
        font=font_name(rtl=rtl),
        size=7.5 if not rtl else 8,
        color=HexColor("#B9CADB"),
    )
    draw_text(
        c,
        "JULY 2026" if not rtl else "يوليو 2026",
        PAGE_W - 42 if not rtl else 42,
        31,
        rtl=rtl,
        font=font_name(rtl=rtl, bold=True),
        size=7.5,
        color=GOLD,
        align="right" if not rtl else "left",
    )


def draw_step_panel(
    c: canvas.Canvas,
    page: Page,
    x: float,
    y: float,
    w: float,
    h: float,
    *,
    rtl: bool,
) -> None:
    rounded_card(c, x, y, w, h, fill=white)
    top = y + h - 24
    for index, (title, body) in enumerate(page.steps, start=1):
        circle_x = x + w - 24 if rtl else x + 24
        c.setFillColor(TEAL if index < len(page.steps) else GOLD)
        c.circle(circle_x, top - 2, 11, fill=1, stroke=0)
        draw_text(
            c,
            str(index),
            circle_x,
            top - 5.2,
            rtl=False,
            font=FONT_BOLD,
            size=7.5,
            color=white if index < len(page.steps) else NAVY,
            align="center",
        )
        text_x = x + 18 if rtl else x + 43
        text_w = w - 61
        title_y = top + 3
        draw_paragraph(
            c,
            title,
            text_x,
            title_y,
            text_w,
            rtl=rtl,
            font=font_name(rtl=rtl, bold=True),
            size=8.8 if not rtl else 9.2,
            leading=11,
            color=INK,
            max_lines=2,
        )
        body_top = title_y - (11 if len(wrap_lines(title, font_name(rtl=rtl, bold=True), 8.8 if not rtl else 9.2, text_w, rtl)) == 1 else 22)
        body_bottom = draw_paragraph(
            c,
            body,
            text_x,
            body_top,
            text_w,
            rtl=rtl,
            font=font_name(rtl=rtl),
            size=7.2 if not rtl else 7.8,
            leading=10.5 if not rtl else 11.3,
            color=SLATE,
            max_lines=4,
        )
        top = body_bottom - 9
        if index < len(page.steps):
            c.setStrokeColor(BORDER)
            c.setLineWidth(0.6)
            c.line(x + 18, top + 4, x + w - 18, top + 4)

    if page.note:
        note_title, note_body = page.note
        note_h = 70
        note_y = y + 16
        c.setFillColor(GOLD_LIGHT)
        c.roundRect(x + 14, note_y, w - 28, note_h, 9, fill=1, stroke=0)
        draw_text(
            c,
            note_title,
            x + w - 27 if rtl else x + 27,
            note_y + note_h - 19,
            rtl=rtl,
            font=font_name(rtl=rtl, bold=True),
            size=7 if not rtl else 7.8,
            color=TEAL_DARK,
        )
        draw_paragraph(
            c,
            note_body,
            x + 27,
            note_y + note_h - 36,
            w - 54,
            rtl=rtl,
            font=font_name(rtl=rtl),
            size=6.9 if not rtl else 7.4,
            leading=9.5 if not rtl else 10.5,
            color=INK,
            max_lines=4,
        )


def screenshot_layout(count: int, x: float, y: float, w: float, h: float) -> list[tuple[float, float, float, float]]:
    gap = 12
    if count <= 1:
        return [(x, y, w, h)]
    if count == 2:
        each_h = (h - gap) / 2
        return [
            (x, y + each_h + gap, w, each_h),
            (x, y, w, each_h),
        ]
    if count == 3:
        top_h = h * 0.57
        bottom_h = h - top_h - gap
        half_w = (w - gap) / 2
        return [
            (x, y + bottom_h + gap, w, top_h),
            (x, y, half_w, bottom_h),
            (x + half_w + gap, y, half_w, bottom_h),
        ]
    half_h = (h - gap) / 2
    half_w = (w - gap) / 2
    slots = []
    for row in range(2):
        for col in range(2):
            slots.append((x + col * (half_w + gap), y + (1 - row) * (half_h + gap), half_w, half_h))
    return slots[:count]


def draw_content_page(
    c: canvas.Canvas,
    manual: Manual,
    page: Page,
    page_number: int,
    screenshot_dir: Path,
) -> None:
    rtl = is_rtl(manual.language)
    c.setFillColor(PAPER)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    c.setFillColor(white)
    c.rect(0, PAGE_H - 90, PAGE_W, 90, fill=1, stroke=0)
    c.setFillColor(TEAL)
    c.rect(0, PAGE_H - 4, PAGE_W, 4, fill=1, stroke=0)
    draw_logo(c, 34, PAGE_H - 54)

    title_x = 293
    title_w = PAGE_W - title_x - 35
    draw_text(
        c,
        page.kicker,
        PAGE_W - 35 if rtl else title_x,
        PAGE_H - 27,
        rtl=rtl,
        font=font_name(rtl=rtl, bold=True),
        size=7 if not rtl else 7.8,
        color=TEAL,
    )
    draw_paragraph(
        c,
        page.title,
        title_x,
        PAGE_H - 50,
        title_w,
        rtl=rtl,
        font=font_name(rtl=rtl, bold=True, title=rtl),
        size=17 if not rtl else 16,
        leading=22,
        color=NAVY,
        max_lines=2,
    )
    draw_paragraph(
        c,
        page.subtitle,
        title_x,
        PAGE_H - 73,
        title_w,
        rtl=rtl,
        font=font_name(rtl=rtl),
        size=7.5 if not rtl else 8,
        leading=10,
        color=SLATE,
        max_lines=2,
    )

    content_y = 62
    content_h = PAGE_H - 171
    left_x = 34
    left_w = 280
    gap = 17
    right_x = left_x + left_w + gap
    right_w = PAGE_W - right_x - 34
    draw_step_panel(c, page, left_x, content_y, left_w, content_h, rtl=rtl)

    shot_y = content_y + 48
    shot_h = content_h - 48
    slots = screenshot_layout(len(page.shots), right_x, shot_y, right_w, shot_h)
    for item, slot in zip(page.shots, slots):
        draw_screenshot(c, item, screenshot_dir, *slot, rtl=rtl)

    if page.flow:
        draw_flow(c, page.flow, right_x, content_y, right_w, rtl=rtl)

    c.setStrokeColor(BORDER)
    c.setLineWidth(0.6)
    c.line(34, 38, PAGE_W - 34, 38)
    footer_text = (
        "AXORA COMPANY PURCHASING MANUAL"
        if manual.audience == "company" and not rtl
        else "AXORA PLATFORM OWNER MANUAL"
        if not rtl
        else "دليل مشتريات شركة أكسورا"
        if manual.audience == "company"
        else "دليل مالك منصة أكسورا"
    )
    draw_text(
        c,
        footer_text,
        PAGE_W - 34 if rtl else 34,
        20,
        rtl=rtl,
        font=font_name(rtl=rtl, bold=True),
        size=6.5 if not rtl else 7,
        color=MUTED,
    )
    draw_text(
        c,
        f"{page_number:02d} / 09",
        34 if rtl else PAGE_W - 34,
        20,
        rtl=False,
        font=FONT_BOLD,
        size=6.5,
        color=TEAL,
        align="left" if rtl else "right",
    )


def build_manual(manual: Manual, output_dir: Path, screenshot_dir: Path) -> Path:
    if len(manual.pages) != 8:
        raise ValueError(f"{manual.filename}: expected 8 content pages after the cover")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / manual.filename
    c = canvas.Canvas(str(output_path), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    c.setTitle(manual.cover_title)
    c.setAuthor("Axora")
    c.setSubject("Axora production user manual")
    c.setCreator("Axora manual generator")

    draw_cover(c, manual, screenshot_dir)
    c.showPage()
    for index, page in enumerate(manual.pages, start=2):
        draw_content_page(c, manual, page, index, screenshot_dir)
        c.showPage()
    c.save()
    return output_path


def missing_screenshots(manuals: Iterable[Manual], screenshot_dir: Path) -> list[str]:
    required = {
        item.filename
        for manual in manuals
        for item in (manual.cover_shot, *(shot_item for page in manual.pages for shot_item in page.shots))
    }
    return sorted(filename for filename in required if screenshot_path(screenshot_dir, filename) is None)


def select_manuals(requested: Sequence[str]) -> list[Manual]:
    if not requested or "all" in requested:
        return list(MANUALS)
    lookup = {f"{manual.audience}-{manual.language}": manual for manual in MANUALS}
    return [lookup[key] for key in requested]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--manual",
        action="append",
        choices=("all", "company-en", "company-ar", "owner-en", "owner-ar"),
        default=[],
        help="Manual to generate; repeat for more than one. Default: all.",
    )
    parser.add_argument(
        "--screenshots-dir",
        type=Path,
        default=DEFAULT_SCREENSHOT_DIR,
        help="Directory containing the screenshot manifest.",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=DEFAULT_OUTPUT_DIR,
        help="Destination directory for generated PDFs.",
    )
    parser.add_argument(
        "--require-screenshots",
        action="store_true",
        help="Fail instead of drawing placeholders when a required screenshot is missing.",
    )
    parser.add_argument(
        "--print-manifest",
        action="store_true",
        help="Print the screenshot manifest as JSON and exit.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.print_manifest:
        print(json.dumps(SCREENSHOT_MANIFEST, indent=2, ensure_ascii=False))
        return 0

    register_fonts()
    manuals = select_manuals(args.manual)
    missing = missing_screenshots(manuals, args.screenshots_dir)
    if missing and args.require_screenshots:
        print("Missing required screenshots:", file=sys.stderr)
        for filename in missing:
            print(f"  - {filename}", file=sys.stderr)
        return 2
    if missing:
        print(
            f"Draft mode: {len(missing)} screenshot(s) are missing; "
            "styled placeholders will be used.",
            file=sys.stderr,
        )

    outputs = [build_manual(manual, args.output_dir, args.screenshots_dir) for manual in manuals]
    for path in outputs:
        print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
