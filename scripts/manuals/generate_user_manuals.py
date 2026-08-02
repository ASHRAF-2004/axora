#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = [
#   "arabic-reshaper==3.0.1",
#   "pillow==12.3.0",
#   "python-bidi==0.6.11",
#   "reportlab==5.0.0",
# ]
# ///
"""Build Axora's exact four deterministic production manuals.

The diagrams in these manuals are truthful workflow illustrations rendered by
this reviewed script. They never contain production data or browser sessions.
"""

from __future__ import annotations

import argparse
import shutil
from dataclasses import dataclass
from pathlib import Path

import arabic_reshaper
from bidi.algorithm import get_display
from PIL import Image
from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output" / "pdf"
PUBLISH = ROOT / "public" / "manuals"
LOGO = ROOT / "public" / "brand" / "axora-logo-dark-background.png"
PAGE_W, PAGE_H = landscape(A4)

NAVY = HexColor("#0B2D52")
AMBER = HexColor("#E8A33D")
PAPER = HexColor("#F5F7FA")
INK = HexColor("#172B3D")
MUTED = HexColor("#5A6B7C")
BORDER = HexColor("#D5DEE8")
SOFT_NAVY = HexColor("#EAF0F6")
SOFT_AMBER = HexColor("#FFF3DF")
SUCCESS = HexColor("#157347")
DANGER = HexColor("#B42318")

SANS = "NotoSans"
SANS_BOLD = "NotoSansBold"
ARABIC = "NotoSansArabic"
ARABIC_BOLD = "NotoSansArabicBold"

FILES = (
    "axora-company-user-manual-en.pdf",
    "axora-company-user-manual-ar.pdf",
    "axora-owner-admin-manual-en.pdf",
    "axora-owner-admin-manual-ar.pdf",
)


@dataclass(frozen=True)
class Topic:
    section: str
    title: str
    intro: str
    steps: tuple[tuple[str, str], ...]
    visual: str
    flow: tuple[str, ...]
    note_title: str
    note: str


@dataclass(frozen=True)
class Manual:
    filename: str
    locale: str
    audience: str
    title: str
    subtitle: str
    audience_line: str
    model: str
    topics: tuple[Topic, ...]


def t(section, title, intro, steps, visual, flow, note_title, note):
    return Topic(section, title, intro, tuple(steps), visual, tuple(flow), note_title, note)


COMPANY_EN = (
    t("WELCOME", "Activate your own account", "Every person uses a named account and creates their own password from a one-time invitation link.", [
        ("Open the invitation", "Check the company, role, branch and expiry shown in the Axora email."),
        ("Create your password", "Use the single-use Axora setup page. The administrator never sees or shares your password."),
        ("Complete your profile", "Confirm your name, job title, phone, language, timezone and branch."),
        ("Follow onboarding", "Complete, skip one step, or return later. Help can restart any role-specific step."),
    ], "invite", ("Invited", "Password created", "Profile", "Tutorial"), "SAFE ACCESS", "Never forward an invitation link or send a password to support."),
    t("NAVIGATION", "Use the top application shell", "The shell keeps frequent work visible while administrative tools stay in the hamburger drawer.", [
        ("Open the hamburger", "Use the three-line button at top left for Settings, Help, Audit history and role-specific tools."),
        ("Check the active logo", "The company logo appears beside the menu and the portal applies its accessible company theme automatically."),
        ("Use common modules", "Dashboard, Shop, Requests, Approvals, Deliveries and Invoices appear only when your role permits them."),
        ("Use profile and language", "Open the avatar at top right for account, security and sign out. Change language beside it."),
    ], "shell", ("Menu", "Company logo", "Common work", "Profile + language"), "MOBILE", "On a phone, open one compact menu and use the same large, labelled actions."),
    t("ROLES & SCOPE", "Give people only the access they need", "Roles control actions. Company and branch scope control which records a person may see.", [
        ("Company Administrator", "Manages company information, branches, budgets, people and company-wide approvals."),
        ("Branch Administrator", "Manages assigned-branch people, requests, budget visibility and deliveries."),
        ("Purchase Requester", "Shops, creates requests and follows records permitted by their scope."),
        ("Approvers and reviewers", "Branch Approver, Company Approver, Finance Reviewer, Receiving User and Read-Only Auditor have separate duties."),
    ], "roles", ("Role", "Company", "Branch", "Permission"), "SEPARATION OF DUTIES", "Nobody may approve their own request. Auditors cannot edit."),
    t("BRANCHES & BUDGET", "Prepare purchasing controls", "A branch defines delivery scope; its budget controls approved purchasing.", [
        ("Confirm branch details", "Check the approved address, receiver, contact number and delivery window."),
        ("Set the monthly budget", "An authorized company administrator sets the branch limit before approvals begin."),
        ("Read budget states", "Available, committed and spent values explain the current purchasing position."),
        ("Watch exceptions", "Over-budget requests are blocked or routed according to approved company rules."),
    ], "budget", ("Monthly limit", "Committed", "Received", "Available"), "NO MANUAL COLOUR EDITOR", "Company colours are derived safely from the logo and cannot be edited by company users."),
    t("SHOP & REQUEST", "Choose products and submit a need", "The Shop contains Axora-managed products with image, name and ordering details.", [
        ("Search the Shop", "Use the product name, code, category or brand; check the image and unit."),
        ("Build the request", "Choose the delivery branch, quantity, need date, priority and business reason."),
        ("Review the estimate", "Confirm every item, the customer price estimate and the available branch budget."),
        ("Submit", "The request enters the approval queue and receives a traceable workflow ID."),
    ], "shop", ("Search", "Cart", "Explain need", "Submit"), "CUSTOMER BOUNDARY", "Company users do not create catalog products or see Axora buying cost or private supplier details."),
    t("APPROVALS", "Make a recorded company decision", "An authorized approver checks the business need, evidence and budget impact.", [
        ("Open the queue", "Review requester, branch, items, amount, documents, need date and prior decisions."),
        ("Check authority", "The decision must be inside your role and branch or company scope."),
        ("Approve or reject", "Record a reason. Rejection and over-budget outcomes remain visible in history."),
        ("Keep approval independent", "Self-approval is blocked: a requester cannot approve their own request."),
    ], "approval", ("Submitted", "Checked", "Decision", "Audit event"), "APPROVAL MEANS", "Approval authorizes company budget; Axora then manages sourcing and fulfilment."),
    t("TRACKING", "Follow the complete request timeline", "The current status and append-only events explain what happened, when and by whom.", [
        ("Open the request", "Read plain-language status, next action, responsible role and expected timing."),
        ("Use the timeline", "Follow approval, quotation, supplier selection, order, delivery, receipt, invoice and payment events."),
        ("Use notifications", "Open role-relevant in-app alerts or safe email links; mark items read when handled."),
        ("Report delays", "Use the workflow ID when asking for help; never send confidential documents outside Axora."),
    ], "timeline", ("Request", "Approval", "Sourcing", "Delivery", "Receipt", "Invoice"), "PRIVACY", "You see only timeline details allowed by your tenant, role and branch scope."),
    t("SUPPLIER COLLABORATION", "Understand the quotation stage", "Axora sends a request for quotation to approved supplier accounts after company approval.", [
        ("Supplier receives the RFQ", "The supplier sees only its organization’s assigned records and shared specifications."),
        ("Supplier submits an offer", "Price, MOQ, lead time, validity, availability, delivery charge and documents are recorded."),
        ("Axora evaluates", "Axora compares offers and records the selection reason. Suppliers cannot select themselves."),
        ("Company follows progress", "Customer users see suitable fulfilment status without private supplier commercial data."),
    ], "supplier", ("RFQ", "Quotation", "Axora selection", "Order"), "CONFIDENTIALITY", "Competing suppliers, quotations, Axora margin and internal selection notes remain private."),
    t("DELIVERY", "Follow a mobile delivery safely", "The assigned driver uses a focused phone portal; the branch keeps independent receiving authority.", [
        ("Assignment", "The driver sees today’s assigned stop, approved address, contact, package summary and instructions."),
        ("Journey events", "Accept, start trip, arrive, attempt, partial delivery, delivered or report an issue."),
        ("Driver evidence", "Upload permitted proof and record receiver name, quantity, damage or missing items."),
        ("Weak network", "Queued events remain visible until synchronized; an event must never disappear silently."),
    ], "driver", ("Assigned", "In transit", "Arrived", "Evidence uploaded"), "LIMITED ACCESS", "Drivers cannot see budgets, invoices, user lists, supplier prices or unrelated requests."),
    t("RECEIVING", "Confirm receipt independently", "Driver evidence is not final acceptance. An assigned Receiving User records inspection.", [
        ("Compare the delivery", "Check product, delivered quantity, packaging and evidence against the approved request."),
        ("Record quantities", "Enter accepted, damaged and missing quantities; partial receipt remains open."),
        ("Raise a discrepancy", "Add a clear reason and permitted evidence for shortage, damage or the wrong item."),
        ("Complete receipt", "Confirm date, receiver identity and final quantities only after inspection."),
    ], "receive", ("Driver evidence", "Inspection", "Partial or final receipt", "Discrepancy"), "INDEPENDENT CONTROL", "A driver cannot create final receiving approval alone."),
    t("FINANCE", "Understand three-way matching and COD records", "Finance compares the approved order, receipt evidence and invoice before reconciliation.", [
        ("Match three records", "Compare approved quantity and price, accepted receipt quantities and the customer invoice."),
        ("Resolve exceptions", "Investigate quantity mismatch, price mismatch, missing file, duplicate invoice or delivery discrepancy."),
        ("Record COD status", "Cash on delivery remains the approved method; Axora records evidence and status, not an online card payment."),
        ("Close with evidence", "Completion requires the allowed approval, receiving, invoice and reconciliation events."),
    ], "match", ("Approved order", "Receipt", "Invoice", "Matched / exception"), "PLAIN LANGUAGE", "Matched means all required records agree. An exception stays open until an authorized person resolves it."),
    t("ACCOUNT", "Protect your profile and sessions", "Your avatar menu contains personal settings without interrupting purchasing work.", [
        ("Keep profile current", "Maintain phone, language, timezone, avatar and notification preference."),
        ("Change password safely", "Enter the current password, create a strong new one and choose whether to sign out other sessions."),
        ("Review active sessions", "End a device session you do not recognize and report suspicious activity."),
        ("Use recovery", "Use the email reset link when needed. Axora never asks you to reveal a password."),
    ], "security", ("Profile", "Security", "Sessions", "Help"), "READY CHECK", "Use a password manager, keep contact details current and sign out on shared devices."),
)


OWNER_EN = (
    t("OWNER ACCESS", "Operate through authorized owner accounts", "Authorized owners use separate Platform Owner accounts; a person's name never defines authorization.", [
        ("Accept a one-time invitation", "Each owner creates their own password and completes profile onboarding."),
        ("Use role assignments", "Platform Owner and Operations Administrator are generic, audited roles."),
        ("Review sessions", "Keep only recognized devices active and use the account security page."),
        ("Protect elevated work", "Use the smallest role possible; Technical Support actions are limited and audited."),
    ], "invite", ("Invite", "Activate", "Profile", "Audit"), "OWNER RULE", "Never share an owner account, invitation link or password."),
    t("COMPANY ONBOARDING", "Create a tenant and its accessible brand", "A Platform Owner records verified company information and uploads the approved company logo.", [
        ("Record the company", "Add name, industry, information, website, contacts, billing details and known branches."),
        ("Process the logo", "Validate file type and bytes, then extract dominant and accent colours deterministically."),
        ("Generate a safe theme", "Create versioned semantic tokens with contrast checks and an Axora fallback."),
        ("Invite the company administrator", "Assign company scope and send the one-time account setup email."),
    ], "brand", ("Company", "Logo", "Accessible tokens", "Invite admin"), "PLATFORM CONTROL", "Only an authorized Platform Owner can regenerate or emergency-correct a theme, and the action is audited."),
    t("PEOPLE & INVITATIONS", "Create scoped users without handling passwords", "Every account separates identity, profile, membership, branch assignment, role, invitation and session state.", [
        ("Choose scope first", "Select company, branch assignment and the smallest canonical role."),
        ("Issue the invitation", "Axora stores only a secure token hash and records issuer, expiry and intended scope."),
        ("Resend safely", "A resend revokes the earlier link and creates a new single-use link."),
        ("Manage lifecycle", "Revoke invitations, deactivate accounts and inspect activation status without seeing passwords."),
    ], "roles", ("Identity", "Membership", "Role + scope", "Invitation"), "CANONICAL ROLES", "Use Platform Owner, Operations Administrator, Company Administrator, Branch Administrator, Branch Approver, Company Approver, Purchase Requester, Finance Reviewer, Read-Only Auditor, Technical Support, Supplier User, Delivery Driver and Receiving User."),
    t("OWNER NAVIGATION", "Run operations from the top shell", "Frequent modules stay in top navigation; system tools and settings stay in the hamburger drawer.", [
        ("Top work", "Use Dashboard, Companies, Catalog, Sourcing, Deliveries and Invoices when permissions allow."),
        ("Drawer work", "Open Settings, Audit history, Reports, Email delivery and system tools."),
        ("Identity controls", "Use the profile at top right and the adjacent language selector."),
        ("Watch tenant context", "Axora staff see Axora branding; company context is explicit before a scoped action."),
    ], "shell", ("Menu", "Axora logo", "Operations", "Profile + language"), "SERVER-SIDE AUTHORIZATION", "A hidden link is not a security control. Every operation verifies role, scope and tenant on the server."),
    t("CATALOG", "Publish recognizable products", "Axora owns the global catalog and keeps private buying data away from customer roles.", [
        ("Search before creating", "Avoid duplicate product names, codes and variants."),
        ("Add customer details", "Use a clear name, category, unit, MOQ, lead time, customer price and concise description."),
        ("Upload a real image", "Validate JPEG, PNG or WebP bytes, optimize locally and write useful alternative text."),
        ("Verify the Shop card", "Confirm image, name, search terms, unit and customer-facing details before activation."),
    ], "catalog", ("Validate", "Describe", "Upload image", "Publish"), "PRIVATE DATA", "Buying cost, supplier identity, margin and internal notes never appear in the company Shop."),
    t("SUPPLIERS & RFQ", "Coordinate suppliers through isolated portals", "Supplier organizations receive only assigned quotation and order records.", [
        ("Maintain supplier records", "Keep contacts, coverage, categories, lead time, terms and active status accurate."),
        ("Send an RFQ", "Share approved specifications and requested response fields without exposing competitors."),
        ("Evaluate offers", "Compare price, MOQ, availability, lead time, validity, delivery charge and documents."),
        ("Select with reason", "Record the authorized selection and notify only the relevant parties."),
    ], "supplier", ("Approved request", "RFQ", "Compare", "Selected order"), "SEPARATION", "A supplier cannot see competitors or select its own offer as the winner."),
    t("TRACKING & NOTIFICATIONS", "Use one end-to-end event model", "Append-only workflow events preserve history beyond the current row status.", [
        ("Correlate the workflow", "Use one workflow ID across request, approval, sourcing, delivery, receipt and invoice."),
        ("Record safe metadata", "Capture actor, role, tenant, branch, time, prior state, new state, reason and source."),
        ("Notify the next actor", "Use deduplicated in-app and email messages with tenant-safe links."),
        ("Watch delays", "Use SLA and exception alerts without exposing private event metadata."),
    ], "timeline", ("Need", "Approval", "Supply", "Delivery", "Receipt", "Finance"), "IMMUTABLE HISTORY", "Never reconstruct critical history only from the current record state."),
    t("DELIVERY OPERATIONS", "Assign drivers with minimum data", "The mobile driver portal shows only the operational information required for assigned deliveries.", [
        ("Create the assignment", "Select the delivery, driver, approved branch address, window and safe instructions."),
        ("Monitor state", "Follow accepted, started, arrived, attempted, partial, delivered, failed and issue events."),
        ("Protect evidence", "Validate files, restrict access and distinguish driver evidence from customer receipt."),
        ("Handle offline events", "Use idempotent synchronization and surface queued or failed delivery actions."),
    ], "driver", ("Assign", "Travel", "Evidence", "Receiver action"), "MINIMUM DISCLOSURE", "Do not expose budgets, invoices, supplier prices, user lists or unrelated customers to a driver."),
    t("RECEIVING", "Keep inspection independent", "Receiving User confirmation establishes what the customer accepted, not merely what the driver reported.", [
        ("Compare evidence", "Review approved lines, driver proof and the physical delivery."),
        ("Capture quantities", "Store delivered, accepted, damaged and missing quantities transactionally."),
        ("Support partial receipt", "Keep the remaining quantity available for a later valid delivery and receipt."),
        ("Manage discrepancies", "Route a reason and evidence to the authorized resolver before final completion."),
    ], "receive", ("Evidence", "Inspect", "Partial / final", "Resolve"), "CONCURRENCY", "Prevent duplicate receipt, stale reservation and repeated-event races with transactions and idempotency."),
    t("FINANCE", "Perform three-way matching and COD reconciliation", "Finance compares approved commercial intent, accepted delivery and invoice evidence.", [
        ("Match the order", "Use approved product, quantity and allowed price."),
        ("Match the receipt", "Use independently accepted quantities and recorded discrepancies."),
        ("Match the invoice", "Detect price, quantity, document and duplicate-invoice exceptions."),
        ("Reconcile COD", "Record receipt evidence and status; resolve exceptions before completion."),
    ], "match", ("Order", "Receipt", "Invoice", "Matched / exception"), "PAYMENT MODEL", "COD is the current approved method. The application records evidence and status; it does not claim to process online payment."),
    t("SECURITY & AUDIT", "Protect every tenant and sensitive action", "Authorization, uploads, authentication, email and support operations require defense in depth.", [
        ("Enforce tenant boundaries", "Verify role and scope server-side and keep supplier/customer private fields separated."),
        ("Protect authentication", "Hash passwords with a slow password algorithm; hash high-entropy tokens; rotate sessions."),
        ("Protect files and links", "Validate MIME and bytes, use safe names, expiry, rate limits and secure headers."),
        ("Audit elevated actions", "Record who changed access, themes, delivery, finance or support state without secrets."),
    ], "security", ("Authenticate", "Authorize", "Validate", "Audit"), "EMAIL SAFETY", "Use the verified Axora sending domain, signed webhooks, suppression handling and a monitored Reply-To address."),
    t("LANGUAGE & SUPPORT", "Operate clearly across languages", "Public detection asks for confirmation; signed-in preference follows the profile across devices.", [
        ("Respect explicit choice", "Never replace a saved language preference with browser detection later."),
        ("Support RTL", "Arabic layout, focus, labels, dates, numbers and emails remain usable and reviewed."),
        ("Use notification preferences", "Send only useful role-aware messages and preserve required security delivery."),
        ("Support safely", "Use workflow IDs and audited diagnostics; never request a user password."),
    ], "localize", ("Detect", "Confirm", "Save", "Synchronize"), "OWNER CHECK", "Review mobile, keyboard, reduced-motion and translated critical flows before release."),
    t("OPERATIONS CHECKLIST", "Verify the complete path before launch", "A production-ready tenant proves its controls with low-risk records before normal purchasing.", [
        ("Identity", "Company, branches, contacts, roles, invitations and receiver assignments are correct."),
        ("Procurement", "Shop, request, independent approval, RFQ, selection and order events are traceable."),
        ("Delivery and finance", "Driver evidence, independent receipt, discrepancy, matching, invoice and COD status work."),
        ("Recovery", "Audit, notifications, backup, restore and rollback procedures have current evidence."),
    ], "check", ("Onboard", "Test", "Inspect", "Approve release"), "DO NOT GUESS", "Quarantine invalid imports and resolve missing business values through review rather than inventing data."),
)


def ar_topic(en: Topic, section: str, title: str, intro: str, steps, note_title: str, note: str, flow) -> Topic:
    return t(section, title, intro, steps, en.visual, flow, note_title, note)


# Arabic content is reviewed copy, not runtime machine translation.
COMPANY_AR = tuple(ar_topic(en, *args) for en, args in zip(COMPANY_EN, (
    ("البدء", "فعّل حسابك الشخصي", "يستخدم كل شخص حساباً مسمى وينشئ كلمة مروره بنفسه من رابط دعوة صالح لمرة واحدة.", [("افتح الدعوة", "راجع الشركة والدور والفرع ووقت الانتهاء في رسالة أكسورا."), ("أنشئ كلمة المرور", "استخدم صفحة الإعداد الآمنة. لا يرى المدير كلمة مرورك ولا يشاركها."), ("أكمل ملفك", "أكد الاسم والمسمى والهاتف واللغة والمنطقة الزمنية والفرع."), ("تابع التهيئة", "أكمل الخطوة أو تجاوز خطوة واحدة أو عد لاحقاً من المساعدة.")], "وصول آمن", "لا تحول رابط الدعوة ولا ترسل كلمة مرورك إلى الدعم.", ("دعوة", "إنشاء كلمة المرور", "ملف شخصي", "تعريف")),
    ("التنقل", "استخدم شريط التطبيق العلوي", "يبقي الشريط العمل المتكرر ظاهراً وتوجد الأدوات الإدارية داخل قائمة الخطوط الثلاثة.", [("افتح القائمة", "من أعلى اليسار تصل إلى الإعدادات والمساعدة والتدقيق وأدوات دورك."), ("تحقق من الشعار", "يظهر شعار الشركة وتطبق الألوان الآمنة المستخرجة منه تلقائياً."), ("استخدم الوحدات", "تظهر لوحة المعلومات والمتجر والطلبات والاعتمادات والتسليم والفواتير حسب صلاحيتك."), ("الملف واللغة", "الملف أعلى اليمين واللغة بجانبه على سطح المكتب.")], "الهاتف", "استخدم قائمة واحدة مدمجة وأزراراً كبيرة ذات تسميات واضحة.", ("القائمة", "شعار الشركة", "العمل", "الملف واللغة")),
    ("الأدوار والنطاق", "امنح أقل وصول لازم", "يحدد الدور الإجراء ويحدد نطاق الشركة والفرع السجلات التي يمكن رؤيتها.", [("مدير الشركة", "يدير معلومات الشركة والفروع والميزانيات والأشخاص والاعتمادات العامة."), ("مدير الفرع", "يدير أشخاص الفرع المعين وطلباته ورؤية ميزانيته وتسليماته."), ("مقدم طلب شراء", "يتسوق وينشئ الطلبات ويتابع السجلات المسموحة."), ("الاعتماد والمراجعة", "معتمد الفرع ومعتمد الشركة ومراجع المالية ومستلم الطلب ومدقق القراءة لهم مهام منفصلة.")], "فصل المهام", "لا يعتمد أحد طلبه بنفسه ولا يستطيع المدقق التعديل.", ("الدور", "الشركة", "الفرع", "الصلاحية")),
    ("الفرع والميزانية", "جهز ضوابط الشراء", "يحدد الفرع نطاق التسليم وتضبط ميزانيته المشتريات المعتمدة.", [("بيانات الفرع", "راجع العنوان والمستلم والهاتف ونافذة التسليم."), ("السقف الشهري", "يحدد مدير شركة مخول ميزانية الفرع قبل الاعتمادات."), ("حالات الميزانية", "توضح القيم المتاح والملتزم والمنفق."), ("الاستثناءات", "تحجب الطلبات المتجاوزة أو توجه وفق القواعد المعتمدة.")], "الألوان", "تستخرج ألوان الشركة من الشعار بأمان ولا يعدلها مستخدمو الشركة.", ("السقف", "الملتزم", "المستلم", "المتاح")),
    ("المتجر والطلب", "اختر المنتجات وأرسل الاحتياج", "يعرض المتجر منتجات تديرها أكسورا مع الصورة والاسم وتفاصيل الطلب.", [("ابحث", "استخدم الاسم أو الرمز أو الفئة أو العلامة وتحقق من الصورة والوحدة."), ("ابن الطلب", "اختر الفرع والكمية وتاريخ الحاجة والأولوية والسبب."), ("راجع التقدير", "تحقق من البنود وتقدير سعر العميل والميزانية المتاحة."), ("أرسل", "يدخل الطلب قائمة الاعتماد ويحصل على معرف مسار.")], "حد العميل", "لا ينشئ مستخدم الشركة المنتجات ولا يرى تكلفة شراء أكسورا أو بيانات المورّد الخاصة.", ("بحث", "سلة", "سبب", "إرسال")),
    ("الاعتمادات", "سجل قرار الشركة", "يراجع المعتمد المخول الاحتياج والأدلة وأثر الميزانية.", [("افتح القائمة", "راجع مقدم الطلب والفرع والبنود والمبلغ والمرفقات والتاريخ."), ("تحقق من النطاق", "يجب أن يكون القرار ضمن دورك ونطاق فرعك أو شركتك."), ("اعتمد أو ارفض", "سجل السبب وتبقى النتيجة في التاريخ."), ("حافظ على الاستقلال", "يمنع النظام مقدم الطلب من اعتماد طلبه.")], "معنى الاعتماد", "يفوض الاعتماد ميزانية الشركة ثم تدير أكسورا التوريد والتنفيذ.", ("إرسال", "مراجعة", "قرار", "تدقيق")),
    ("التتبع", "تابع المسار الكامل", "توضح الحالة الحالية والأحداث الملحقة ماذا حدث ومتى ومن نفذه.", [("افتح الطلب", "اقرأ الحالة والإجراء التالي والدور المسؤول والوقت المتوقع."), ("استخدم الخط الزمني", "تابع الاعتماد والعروض والاختيار والطلب والتسليم والاستلام والفاتورة والدفع."), ("استخدم التنبيهات", "افتح تنبيهات دورك الآمنة وعلمها مقروءة بعد المعالجة."), ("أبلغ عن التأخير", "استخدم معرف المسار ولا ترسل ملفات سرية خارج أكسورا.")], "الخصوصية", "لا ترى إلا تفاصيل يسمح بها المستأجر والدور ونطاق الفرع.", ("طلب", "اعتماد", "توريد", "تسليم", "استلام", "فاتورة")),
    ("تعاون المورّد", "افهم مرحلة عرض السعر", "ترسل أكسورا طلب عرض إلى حسابات مورّدين معتمدين بعد اعتماد الشركة.", [("يستلم المورّد", "يرى المورّد السجلات المسندة لمنظمته والمواصفات المشتركة فقط."), ("يقدم العرض", "يسجل السعر والحد الأدنى والمدة والصلاحية والتوفر ورسوم التسليم والمستندات."), ("تقيم أكسورا", "تقارن العروض وتسجل سبب الاختيار ولا يختار المورّد نفسه."), ("تتابع الشركة", "يرى العميل حالة تنفيذ مناسبة دون بيانات تجارية خاصة.")], "السرية", "تبقى عروض المنافسين وهامش أكسورا وملاحظات الاختيار الداخلية خاصة.", ("طلب عرض", "عرض", "اختيار أكسورا", "أمر")),
    ("التسليم", "تابع التسليم عبر الهاتف", "يستخدم السائق المسند بوابة هاتف مركزة ويحافظ الفرع على سلطة استلام مستقلة.", [("المهمة", "يرى السائق محطة اليوم والعنوان وجهة الاتصال والطرود والتعليمات."), ("أحداث الرحلة", "قبول وبدء ووصول ومحاولة وتسليم جزئي أو كامل أو مشكلة."), ("دليل السائق", "يرفع الدليل المسموح ويسجل اسم المستلم والكمية والتلف أو النقص."), ("الشبكة الضعيفة", "تبقى الأحداث في الانتظار ظاهرة حتى المزامنة ولا تختفي بصمت.")], "وصول محدود", "لا يرى السائق الميزانيات أو الفواتير أو المستخدمين أو أسعار المورّد أو الطلبات الأخرى.", ("مسند", "في الطريق", "وصل", "رفع الدليل")),
    ("الاستلام", "أكد الاستلام باستقلال", "دليل السائق ليس قبولاً نهائياً ويسجل مستخدم الاستلام المعين نتيجة الفحص.", [("قارن التسليم", "راجع المنتج والكمية والتغليف والدليل مقابل الطلب المعتمد."), ("سجل الكميات", "أدخل المقبول والتالف والناقص ويبقى الاستلام الجزئي مفتوحاً."), ("افتح اختلافاً", "أضف سبباً ودليلاً مسموحاً للنقص أو التلف أو الصنف الخطأ."), ("أكمل الاستلام", "أكد التاريخ والهوية والكميات النهائية بعد الفحص.")], "ضبط مستقل", "لا يستطيع السائق وحده إنشاء اعتماد استلام نهائي.", ("دليل السائق", "فحص", "جزئي أو نهائي", "اختلاف")),
    ("المالية", "افهم المطابقة والدفع عند الاستلام", "تقارن المالية الطلب المعتمد ودليل الاستلام والفاتورة قبل التسوية.", [("طابق ثلاثة سجلات", "قارن الكمية والسعر المعتمدين والكميات المقبولة وفاتورة العميل."), ("حل الاستثناءات", "حقق في اختلاف الكمية أو السعر أو الملف الناقص أو الفاتورة المكررة."), ("سجل حالة الدفع", "الدفع عند الاستلام هو الأسلوب المعتمد وتدون أكسورا الدليل والحالة."), ("أغلق بالدليل", "يتطلب الإكمال أحداث الاعتماد والاستلام والفاتورة والتسوية.")], "شرح", "تعني مطابق أن السجلات المطلوبة متفقة ويبقى الاستثناء مفتوحاً حتى حله.", ("طلب معتمد", "استلام", "فاتورة", "مطابق أو استثناء")),
    ("الحساب", "احم ملفك وجلساتك", "توجد الإعدادات الشخصية في قائمة الملف دون مقاطعة العمل.", [("حدث الملف", "حافظ على الهاتف واللغة والمنطقة والصورة والتنبيهات."), ("غير كلمة المرور", "أدخل الحالية ثم أنشئ كلمة قوية واختر إنهاء الجلسات الأخرى."), ("راجع الجلسات", "أنه جلسة جهاز غير معروف وأبلغ عن النشاط المريب."), ("استخدم الاستعادة", "استخدم رابط البريد الآمن ولا تكشف كلمة المرور لأكسورا.")], "الجاهزية", "استخدم مدير كلمات مرور وسجل الخروج من الأجهزة المشتركة.", ("الملف", "الأمان", "الجلسات", "المساعدة")),
)))


# Owner Arabic uses the same verified diagrams with concise operational copy.
OWNER_AR = tuple(ar_topic(en, *args) for en, args in zip(OWNER_EN, (
    ("وصول المالك", "شغل المنصة بحسابات مالك مخولة", "يستخدم المالكون المخولون حسابات مالك منصة منفصلة ولا يحدد اسم الشخص الصلاحية.", [("اقبل الدعوة", "ينشئ كل مالك كلمة مروره ويكمل ملفه."), ("استخدم الأدوار", "مالك المنصة ومدير العمليات أدوار عامة ومدققة."), ("راجع الجلسات", "أبق الأجهزة المعروفة فقط نشطة."), ("احم العمل", "استخدم أقل دور وتخضع إجراءات الدعم للتدقيق.")], "قاعدة المالك", "لا تشارك حساب المالك أو الدعوة أو كلمة المرور.", ("دعوة", "تفعيل", "ملف", "تدقيق")),
    ("تهيئة الشركة", "أنشئ المستأجر وهويته الآمنة", "يسجل المالك معلومات الشركة ويرفع شعارها المعتمد.", [("سجل الشركة", "أضف الاسم والصناعة والمعلومات والموقع والاتصال والفوترة والفروع."), ("عالج الشعار", "تحقق من نوع الملف ومحتواه واستخرج الألوان بشكل حتمي."), ("ولد النسق", "أنشئ رموزاً دلالية بإصدارات وتباين آمن وبديل أكسورا."), ("ادع مدير الشركة", "عين نطاق الشركة وأرسل رابط الإعداد لمرة واحدة.")], "تحكم المنصة", "يولد المالك المخول النسق أو يصححه في الطوارئ مع التدقيق.", ("شركة", "شعار", "ألوان آمنة", "دعوة")),
    ("الأشخاص والدعوات", "أنشئ مستخدمين بنطاق دون كلمات مرور", "يفصل النظام الهوية والملف والعضوية والفرع والدور والدعوة والجلسة.", [("اختر النطاق", "حدد الشركة والفرع وأقل دور قياسي."), ("أصدر الدعوة", "تخزن أكسورا تجزئة الرمز وتسجل المصدر والانتهاء والنطاق."), ("أعد الإرسال", "يلغي الرابط السابق ويصدر رابطاً جديداً لمرة واحدة."), ("أدر الدورة", "ألغ الدعوة أو عطل الحساب دون رؤية كلمة المرور.")], "الأدوار القياسية", "استخدم الأدوار العامة ونطاقاتها ولا تربط الصلاحيات بأسماء الأشخاص.", ("هوية", "عضوية", "دور ونطاق", "دعوة")),
    ("تنقل المالك", "أدر العمليات من الشريط العلوي", "تبقى الوحدات المتكررة أعلى الصفحة والأدوات والإعدادات داخل قائمة الخطوط الثلاثة.", [("العمل العلوي", "استخدم اللوحة والشركات والكتالوج والتوريد والتسليم والفواتير."), ("أدوات القائمة", "افتح الإعدادات والتدقيق والتقارير والبريد وأدوات النظام."), ("الهوية", "يوجد الملف أعلى اليمين واللغة بجانبه."), ("سياق المستأجر", "يرى موظف أكسورا هويتها ويظهر سياق الشركة قبل الإجراء.")], "تفويض الخادم", "يتحقق كل إجراء من الدور والنطاق والمستأجر على الخادم.", ("قائمة", "شعار أكسورا", "عمليات", "ملف ولغة")),
    ("الكتالوج", "انشر منتجات سهلة التعرف", "تملك أكسورا الكتالوج وتحجب بيانات الشراء الخاصة عن العميل.", [("ابحث أولاً", "تجنب تكرار الأسماء والرموز والمتغيرات."), ("أضف تفاصيل العميل", "اكتب اسماً وفئة ووحدة وحداً أدنى ومدة وسعراً ووصفاً."), ("ارفع صورة حقيقية", "تحقق من JPEG أو PNG أو WebP وحسنها واكتب نصاً بديلاً."), ("تحقق من بطاقة المتجر", "راجع الصورة والاسم والبحث والوحدة قبل التفعيل.")], "بيانات خاصة", "لا يظهر للعميل سعر الشراء أو هوية المورّد أو الهامش أو الملاحظات.", ("تحقق", "وصف", "صورة", "نشر")),
    ("المورّدون والعروض", "نسق المورّدين عبر بوابات معزولة", "ترى منظمة المورّد السجلات المسندة إليها فقط.", [("حافظ على السجل", "حدث الاتصال والتغطية والفئات والمدة والشروط والحالة."), ("أرسل طلب عرض", "شارك المواصفات المعتمدة دون كشف المنافسين."), ("قيم العروض", "قارن السعر والحد والتوفر والمدة والصلاحية والرسوم والمستندات."), ("اختر بسبب", "سجل الاختيار المخول وأبلغ الأطراف اللازمة فقط.")], "فصل", "لا يرى المورّد منافسيه ولا يختار عرضه بنفسه.", ("طلب معتمد", "طلب عرض", "مقارنة", "أمر مختار")),
    ("التتبع والتنبيهات", "استخدم نموذج أحداث واحداً", "تحفظ الأحداث الملحقة التاريخ أبعد من الحالة الحالية.", [("اربط المسار", "استخدم معرفاً واحداً للطلب والاعتماد والتوريد والتسليم والاستلام والفاتورة."), ("سجل بيانات آمنة", "المنفذ والدور والمستأجر والفرع والوقت والحالتان والسبب والمصدر."), ("نبه التالي", "استخدم رسائل داخلية وبريدية غير مكررة بروابط آمنة."), ("راقب التأخير", "استخدم إنذارات المدة والاستثناء دون كشف بيانات خاصة.")], "تاريخ ثابت", "لا تبن التاريخ الحرج من حالة الصف الحالية فقط.", ("احتياج", "اعتماد", "توريد", "تسليم", "استلام", "مالية")),
    ("عمليات التسليم", "اسند السائق بأقل بيانات", "تعرض بوابة الهاتف معلومات المهمة المسندة فقط.", [("أنشئ المهمة", "حدد التسليم والسائق وعنوان الفرع والنافذة والتعليمات."), ("راقب الحالة", "تابع القبول والبدء والوصول والمحاولة والجزئي والكامل والفشل."), ("احم الدليل", "تحقق من الملفات وافصل دليل السائق عن استلام العميل."), ("عالج عدم الاتصال", "استخدم مزامنة متكررة آمنة وأظهر الأحداث المنتظرة أو الفاشلة.")], "أقل كشف", "لا تكشف الميزانية أو الفواتير أو المورد أو المستخدمين أو العملاء الآخرين للسائق.", ("إسناد", "رحلة", "دليل", "استلام")),
    ("الاستلام", "حافظ على فحص مستقل", "يثبت تأكيد المستلم ما قبله العميل لا ما ذكره السائق فقط.", [("قارن الدليل", "راجع البنود المعتمدة ودليل السائق والبضاعة."), ("التقط الكميات", "خزن المسلم والمقبول والتالف والناقص بمعاملة."), ("ادعم الجزئي", "أبق الكمية المتبقية متاحة لتسليم لاحق صالح."), ("أدر الاختلاف", "وجه السبب والدليل إلى المخول قبل الإكمال.")], "التزامن", "امنع تكرار الاستلام والحجز القديم والحدث المتكرر بالمعاملات والتكرار الآمن.", ("دليل", "فحص", "جزئي أو نهائي", "حل")),
    ("المالية", "نفذ المطابقة وتسوية الدفع عند الاستلام", "تقارن المالية النية التجارية والاستلام المقبول ودليل الفاتورة.", [("طابق الطلب", "استخدم المنتج والكمية والسعر المسموح المعتمد."), ("طابق الاستلام", "استخدم الكميات المقبولة والاختلافات."), ("طابق الفاتورة", "اكشف السعر والكمية والملف والفاتورة المكررة."), ("سو الدفع", "سجل الدليل والحالة وحل الاستثناء قبل الإكمال.")], "نموذج الدفع", "الدفع عند الاستلام هو المعتمد ويسجل التطبيق الدليل والحالة.", ("طلب", "استلام", "فاتورة", "مطابق أو استثناء")),
    ("الأمان والتدقيق", "احم كل مستأجر وإجراء حساس", "يحتاج التفويض والرفع والمصادقة والبريد والدعم إلى دفاع متعدد.", [("اعزل المستأجر", "تحقق من الدور والنطاق وافصل حقول المورّد والعميل."), ("احم المصادقة", "جزئ كلمات المرور بخوارزمية بطيئة والرموز عالية العشوائية ودوّر الجلسات."), ("احم الملفات", "تحقق من النوع والمحتوى والاسم والانتهاء والحدود والرؤوس."), ("دقق الارتفاع", "سجل تغييرات الوصول والهوية والتسليم والمالية والدعم دون أسرار.")], "سلامة البريد", "استخدم نطاق أكسورا الموثق وتوقيع الويب هوك وقائمة المنع وعنوان رد مراقباً.", ("مصادقة", "تفويض", "تحقق", "تدقيق")),
    ("اللغة والدعم", "شغل بوضوح عبر اللغات", "يسأل الكشف العام للتأكيد وتتبع اللغة ملف المستخدم عبر الأجهزة.", [("احترم الاختيار", "لا تستبدل الاختيار المحفوظ بكشف المتصفح لاحقاً."), ("ادعم RTL", "تبقى العربية والتركيز والتواريخ والأرقام والبريد صالحة."), ("تفضيلات التنبيه", "أرسل رسائل مفيدة للدور وحافظ على رسائل الأمان."), ("ادعم بأمان", "استخدم معرف المسار وتشخيصاً مدققاً ولا تطلب كلمة المرور.")], "تحقق المالك", "راجع الهاتف ولوحة المفاتيح وتقليل الحركة والترجمات قبل الإطلاق.", ("كشف", "تأكيد", "حفظ", "مزامنة")),
    ("قائمة التشغيل", "تحقق من المسار قبل الإطلاق", "يثبت المستأجر ضوابطه بسجلات منخفضة المخاطر قبل الشراء المعتاد.", [("الهوية", "الشركة والفروع والاتصال والأدوار والدعوات والمستلم صحيحة."), ("المشتريات", "المتجر والطلب والاعتماد المستقل والعرض والاختيار قابلة للتتبع."), ("التسليم والمالية", "دليل السائق والاستلام والاختلاف والمطابقة والفاتورة والدفع تعمل."), ("التعافي", "للتدقيق والتنبيه والنسخ والاستعادة والرجوع دليل حديث.")], "لا تخمن", "اعزل صفوف الاستيراد غير الصالحة وعالج النواقص بالمراجعة.", ("تهيئة", "اختبار", "فحص", "اعتماد")),
)))


MANUALS = (
    Manual(FILES[0], "en", "company", "Company procurement manual", "From secure invitation to receiving and reconciliation", "For Company Administrators, Branch Administrators, Approvers, Requesters, Finance Reviewers, Receivers and Auditors", "Your company controls people, branches, budgets, requests, approvals and receiving. Axora controls the global catalog, private sourcing and operational fulfilment.", COMPANY_EN),
    Manual(FILES[1], "ar", "company", "دليل مشتريات الشركة", "من الدعوة الآمنة إلى الاستلام والتسوية", "لمديري الشركة والفروع والمعتمدين ومقدمي الطلبات ومراجعي المالية والمستلمين والمدققين", "تتحكم شركتك في الأشخاص والفروع والميزانيات والطلبات والاعتمادات والاستلام، وتتحكم أكسورا في الكتالوج العام والتوريد الخاص والتنفيذ التشغيلي.", COMPANY_AR),
    Manual(FILES[2], "en", "owner", "Axora platform owner manual", "Tenant onboarding, catalog, sourcing, delivery, finance and security", "For authorized Axora Platform Owners", "Axora owns platform governance, tenant onboarding, the global catalog, private suppliers, sourcing, delivery operations, finance controls, audit and recovery.", OWNER_EN),
    Manual(FILES[3], "ar", "owner", "دليل مالك منصة أكسورا", "تهيئة الشركات والكتالوج والتوريد والتسليم والمالية والأمان", "لمالكي منصة أكسورا المخولين", "تملك أكسورا حوكمة المنصة وتهيئة المستأجرين والكتالوج العام والموردين الخاصين والتوريد والتسليم وضوابط المالية والتدقيق والتعافي.", OWNER_AR),
)


def register_fonts() -> None:
    paths = {
        SANS: "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf",
        SANS_BOLD: "/usr/share/fonts/truetype/noto/NotoSans-Bold.ttf",
        ARABIC: "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf",
        ARABIC_BOLD: "/usr/share/fonts/truetype/noto/NotoSansArabic-Bold.ttf",
    }
    missing = [path for path in paths.values() if not Path(path).is_file()]
    if missing:
        raise SystemExit("Missing Noto fonts: " + ", ".join(missing))
    for name, path in paths.items():
        pdfmetrics.registerFont(TTFont(name, path))


def rtl(locale: str) -> bool:
    return locale == "ar"


def shape(value: str, is_rtl: bool) -> str:
    return get_display(arabic_reshaper.reshape(value), base_dir="R") if is_rtl else value


def fonts(is_rtl: bool, bold: bool = False) -> str:
    if is_rtl:
        return ARABIC_BOLD if bold else ARABIC
    return SANS_BOLD if bold else SANS


def wrap(value: str, width: float, size: float, font: str, is_rtl: bool) -> list[str]:
    words = value.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if not current or pdfmetrics.stringWidth(shape(candidate, is_rtl), font, size) <= width:
            current = candidate
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def text(c, value, x, y, width, size, is_rtl, *, bold=False, color=INK, leading=None, max_lines=5):
    font = fonts(is_rtl, bold)
    lines = wrap(value, width, size, font, is_rtl)[:max_lines]
    lead = leading or size * 1.4
    c.setFont(font, size)
    c.setFillColor(color)
    for line in lines:
        shown = shape(line, is_rtl)
        if is_rtl:
            c.drawRightString(x + width, y, shown)
        else:
            c.drawString(x, y, shown)
        y -= lead
    return y


def label(c, value, x, y, size, is_rtl, *, bold=False, color=INK, align="left"):
    c.setFont(fonts(is_rtl, bold), size)
    c.setFillColor(color)
    shown = shape(value, is_rtl)
    if align == "center": c.drawCentredString(x, y, shown)
    elif align == "right" or is_rtl: c.drawRightString(x, y, shown)
    else: c.drawString(x, y, shown)


def draw_logo(c, x, y, w=150):
    if not LOGO.is_file():
        raise SystemExit(f"Approved logo missing: {LOGO}")
    with Image.open(LOGO) as im:
        ratio = im.height / im.width
    c.drawImage(ImageReader(str(LOGO)), x, y, width=w, height=w * ratio, preserveAspectRatio=True, mask="auto")


def rounded(c, x, y, w, h, fill=white, stroke=BORDER, radius=10):
    c.setFillColor(fill); c.setStrokeColor(stroke); c.setLineWidth(.8)
    c.roundRect(x, y, w, h, radius, fill=1, stroke=1)


def draw_flow(c, labels, x, y, w, is_rtl):
    items = list(reversed(labels)) if is_rtl else list(labels)
    gap = 7; iw = (w - gap * (len(items)-1)) / len(items)
    for i, item in enumerate(items):
        bx = x + i * (iw + gap)
        rounded(c, bx, y, iw, 38, SOFT_NAVY, SOFT_NAVY, 8)
        c.setFillColor(AMBER if i == len(items)-1 else NAVY); c.circle(bx + iw/2, y+31, 6, fill=1, stroke=0)
        text(c, item, bx+5, y+19, iw-10, 7.2 if not is_rtl else 8, is_rtl, bold=True, color=NAVY, max_lines=2)


def draw_visual(c, kind, x, y, w, h, is_rtl):
    rounded(c, x, y, w, h, PAPER, BORDER, 12)
    title = "WORKFLOW ILLUSTRATION" if not is_rtl else "رسم توضيحي للمسار"
    label(c, title, x+w-15 if is_rtl else x+15, y+h-22, 7.2, is_rtl, bold=True, color=MUTED)
    labels = {
        "invite": ("Invite", "Set password", "Profile", "Onboarding"),
        "shell": ("☰", "AXORA / COMPANY", "Dashboard  Shop  Requests", "Profile  EN"),
        "roles": ("ROLE", "TENANT", "BRANCH", "ACTION"),
        "brand": ("Company logo", "Colour extraction", "Contrast", "Versioned theme"),
        "budget": ("Monthly limit", "Committed", "Received", "Available"),
        "shop": ("Search", "Product card", "Cart", "Request"),
        "catalog": ("Validate", "Product details", "Image", "Publish"),
        "approval": ("Requester", "Independent approver", "Decision", "Event"),
        "supplier": ("RFQ", "Supplier quotation", "Axora evaluates", "Order"),
        "timeline": ("Request", "Approval", "Supply", "Delivery", "Receipt", "Finance"),
        "driver": ("Assigned", "In transit", "Arrived", "Evidence"),
        "receive": ("Driver proof", "Receiver inspection", "Quantities", "Discrepancy"),
        "match": ("Approved order", "Accepted receipt", "Invoice", "Match"),
        "security": ("Account", "Role + scope", "Tenant check", "Audit"),
        "localize": ("Browser", "Confirm", "Profile", "RTL"),
        "check": ("Configure", "Test", "Review", "Release"),
    }.get(kind, ("Start", "Review", "Record", "Complete"))
    # Visual labels are localized generically on Arabic pages to avoid presenting English as UI copy.
    if is_rtl:
        labels = tuple({
            "Invite":"دعوة", "Set password":"كلمة المرور", "Profile":"الملف", "Onboarding":"التهيئة",
            "Company logo":"شعار الشركة", "Colour extraction":"استخراج الألوان", "Contrast":"التباين", "Versioned theme":"نسق بإصدار",
            "Monthly limit":"السقف", "Committed":"الملتزم", "Received":"المستلم", "Available":"المتاح",
            "Search":"بحث", "Product card":"بطاقة منتج", "Cart":"سلة", "Request":"طلب",
            "Validate":"تحقق", "Product details":"تفاصيل", "Image":"صورة", "Publish":"نشر",
            "Requester":"مقدم الطلب", "Independent approver":"معتمد مستقل", "Decision":"قرار", "Event":"حدث",
            "RFQ":"طلب عرض", "Supplier quotation":"عرض المورّد", "Axora evaluates":"تقييم أكسورا", "Order":"أمر",
            "Approval":"اعتماد", "Supply":"توريد", "Delivery":"تسليم", "Receipt":"استلام", "Finance":"مالية",
            "Assigned":"مسند", "In transit":"في الطريق", "Arrived":"وصل", "Evidence":"دليل",
            "Driver proof":"دليل السائق", "Receiver inspection":"فحص المستلم", "Quantities":"كميات", "Discrepancy":"اختلاف",
            "Approved order":"طلب معتمد", "Accepted receipt":"استلام مقبول", "Invoice":"فاتورة", "Match":"مطابقة",
            "Account":"حساب", "Role + scope":"دور ونطاق", "Tenant check":"تحقق المستأجر", "Audit":"تدقيق",
            "Browser":"متصفح", "Confirm":"تأكيد", "RTL":"يمين إلى يسار",
            "Configure":"إعداد", "Test":"اختبار", "Review":"مراجعة", "Release":"إطلاق",
            "ROLE":"دور", "TENANT":"مستأجر", "BRANCH":"فرع", "ACTION":"إجراء",
            "☰":"قائمة", "AXORA / COMPANY":"أكسورا / الشركة",
            "Dashboard  Shop  Requests":"اللوحة والمتجر والطلبات", "Profile  EN":"الملف واللغة",
        }.get(v, v) for v in labels)
    count = len(labels); gap=10; iw=(w-40-gap*(count-1))/count
    for i, item in enumerate(reversed(labels) if is_rtl else labels):
        bx=x+20+i*(iw+gap); by=y+42
        rounded(c,bx,by,iw,h-82,white,BORDER,9)
        c.setFillColor(AMBER if i==count-1 else NAVY); c.circle(bx+iw/2,by+h-105,12,fill=1,stroke=0)
        label(c,str(count-i if is_rtl else i+1),bx+iw/2,by+h-108,8,False,bold=True,color=white,align="center")
        text(c,item,bx+8,by+h-135,iw-16,8 if not is_rtl else 9,is_rtl,bold=True,color=NAVY,max_lines=3)
        if i<count-1:
            c.setStrokeColor(AMBER); c.setLineWidth(2); c.line(bx+iw+1,by+(h-82)/2,bx+iw+gap-1,by+(h-82)/2)


def header(c, manual, number):
    c.setFillColor(white); c.rect(0,0,PAGE_W,PAGE_H,fill=1,stroke=0)
    c.setFillColor(NAVY); c.rect(0,PAGE_H-65,PAGE_W,65,fill=1,stroke=0)
    draw_logo(c, 34, PAGE_H-54, 125)
    label(c, manual.title, PAGE_W-35, PAGE_H-43, 8, rtl(manual.locale), bold=True, color=white, align="right")
    c.setStrokeColor(AMBER); c.setLineWidth(3); c.line(34,28,PAGE_W-34,28)
    label(c, f"{number:02d}", PAGE_W-34, 13, 7, False, bold=True, color=NAVY, align="right")
    label(c, "AXORA.MANAGEMENT", 34, 13, 7, False, bold=True, color=MUTED)


def cover(c, manual):
    is_rtl=rtl(manual.locale)
    c.setFillColor(NAVY); c.rect(0,0,PAGE_W,PAGE_H,fill=1,stroke=0)
    c.setFillColor(AMBER); c.circle(PAGE_W+35,PAGE_H+20,210,fill=1,stroke=0)
    c.setFillColor(HexColor("#133E68")); c.circle(PAGE_W-35,-40,160,fill=1,stroke=0)
    rounded(c,38,PAGE_H-82,195,48,white,white,10); draw_logo(c,56,PAGE_H-70,160)
    tx=42; tw=355
    text(c,manual.title,tx,PAGE_H-150,tw,29 if not is_rtl else 27,is_rtl,bold=True,color=white,leading=40,max_lines=3)
    text(c,manual.subtitle,tx,PAGE_H-255,tw,13,is_rtl,bold=True,color=AMBER,leading=20,max_lines=3)
    text(c,manual.audience_line,tx,PAGE_H-325,tw,9.5 if not is_rtl else 10,is_rtl,color=white,leading=15,max_lines=4)
    rounded(c,42,95,355,105,HexColor("#133E68"),HexColor("#315878"),12)
    text(c,manual.model,58,171,323,9 if not is_rtl else 9.7,is_rtl,color=white,leading=14,max_lines=6)
    draw_visual(c,"timeline",430,120,360,320,is_rtl)
    label(c,"AXORA PROCUREMENT PLATFORM",42,42,8,False,bold=True,color=AMBER)
    label(c,"2026 EDITION" if not is_rtl else "إصدار 2026",PAGE_W-42,42,8,is_rtl,bold=True,color=white,align="right")
    c.showPage()


def topic_page(c, manual, topic, number):
    is_rtl=rtl(manual.locale); header(c,manual,number)
    label(c,topic.section,40 if not is_rtl else PAGE_W-40,PAGE_H-92,8,is_rtl,bold=True,color=AMBER,align="right" if is_rtl else "left")
    text(c,topic.title,40,PAGE_H-119,PAGE_W-80,22 if not is_rtl else 21,is_rtl,bold=True,color=NAVY,leading=30,max_lines=2)
    text(c,topic.intro,40,PAGE_H-172,350,9 if not is_rtl else 9.7,is_rtl,color=MUTED,leading=14,max_lines=3)
    draw_visual(c,topic.visual,425,166,370,285,is_rtl)
    y=PAGE_H-215
    for index,(heading,body) in enumerate(topic.steps,1):
        rounded(c,40,y-68,350,74,white,BORDER,9)
        cx=365 if is_rtl else 65
        c.setFillColor(AMBER if index==4 else NAVY); c.circle(cx,y-17,12,fill=1,stroke=0)
        label(c,str(index),cx,y-20,8,False,bold=True,color=white,align="center")
        text(c,heading,82 if not is_rtl else 52,y-4,288,9 if not is_rtl else 9.5,is_rtl,bold=True,color=NAVY,max_lines=1)
        text(c,body,82 if not is_rtl else 52,y-23,288,7.4 if not is_rtl else 8,is_rtl,color=MUTED,leading=10.5,max_lines=4)
        y-=83
    rounded(c,425,74,370,70,SOFT_AMBER,SOFT_AMBER,10)
    text(c,topic.note_title,441,123,338,7.5 if not is_rtl else 8,is_rtl,bold=True,color=NAVY,max_lines=1)
    text(c,topic.note,441,103,338,7.2 if not is_rtl else 7.8,is_rtl,color=INK,leading=10,max_lines=4)
    draw_flow(c,topic.flow,425,32,370,is_rtl)
    c.showPage()


def build(manual: Manual, path: Path) -> None:
    path.parent.mkdir(parents=True,exist_ok=True)
    c=canvas.Canvas(str(path),pagesize=(PAGE_W,PAGE_H),pageCompression=1,invariant=1)
    c.setTitle(manual.title); c.setAuthor("Axora"); c.setSubject("Axora procurement operations")
    cover(c,manual)
    for number,topic in enumerate(manual.topics,2): topic_page(c,manual,topic,number)
    c.save()


def main() -> int:
    parser=argparse.ArgumentParser()
    parser.add_argument("--output-dir",type=Path,default=OUTPUT)
    parser.add_argument("--publish",action="store_true",help="Copy the exact allowlist into public/manuals")
    args=parser.parse_args(); register_fonts()
    for manual in MANUALS:
        destination=args.output_dir/manual.filename; build(manual,destination)
        print(destination)
    if args.publish:
        PUBLISH.mkdir(parents=True,exist_ok=True)
        unexpected=[p.name for p in PUBLISH.glob("*.pdf") if p.name not in FILES]
        if unexpected: raise SystemExit("Refusing publish: unexpected manual PDF(s): "+", ".join(sorted(unexpected)))
        for name in FILES: shutil.copyfile(args.output_dir/name,PUBLISH/name)
        print("Published exact allowlist: "+", ".join(FILES))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
