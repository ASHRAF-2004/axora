import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";
import sharp from "sharp";

const REGULAR_FONT = fileURLToPath(new URL("./fonts/DejaVuSans.ttf", import.meta.url));
const BOLD_FONT = fileURLToPath(new URL("./fonts/DejaVuSans-Bold.ttf", import.meta.url));
const AXORA_LOGO = fileURLToPath(new URL("../public/brand/axora-logo.png", import.meta.url));
const PAGE = { width: 595.28, height: 841.89, margin: 46, header: 82, footer: 38 };
const FORBIDDEN = {
  common: ["password", "passwordhash", "token", "secret", "sessionid", "internalnotes"],
  customer: [
    "supplier", "supplierid", "suppliername", "suppliercode", "supplierunitprice",
    "quotationreference", "unitbuyprice", "buyunitprice", "baseunitprice", "buycost",
    "basecost", "actualbuyunitprice", "commercialbasecostsnapshot",
    "commercialmarkuppercentagesnapshot", "markup", "margin",
  ],
  supplier: [
    "budget", "budgetaccount", "budgetbalance", "remainingreserved", "spentamount",
    "releasedamount", "contractualceiling", "companyceiling", "requester", "approver",
    "driver", "deliveryagent", "actualbuyunitprice", "markup", "margin", "othersupplier",
  ],
};

const COPY = {
  en: {
    approvedTitle: "Approved Purchase Request",
    finalTitle: "Final Fulfilment and Delivery Record",
    poTitle: "Supplier Purchase Order",
    reference: "Reference", version: "Version", status: "Status", generated: "Generated",
    organization: "Organization", request: "Request details", approval: "Approval history",
    estimate: "Approved estimate", actual: "Actual purchase", delivery: "Delivery record",
    history: "Workflow history", budget: "Budget record", supplier: "Supplier",
    shipTo: "Ship to", items: "Items", totals: "Totals", warnings: "Dispatch warnings",
    name: "Item", sku: "SKU", quantity: "Qty", unit: "Unit", price: "Unit price",
    charge: "Charges", total: "Total", date: "Date", event: "Event", evidence: "Evidence",
    yes: "Yes", no: "No", noValue: "Not recorded", page: "Page", of: "of", checksum: "Document checksum",
  },
  ar: {
    approvedTitle: "طلب شراء معتمد",
    finalTitle: "سجل التجهيز والتسليم النهائي",
    poTitle: "أمر شراء المورد",
    reference: "المرجع", version: "الإصدار", status: "الحالة", generated: "تاريخ الإنشاء",
    organization: "المنشأة", request: "تفاصيل الطلب", approval: "سجل الموافقات",
    estimate: "التقدير المعتمد", actual: "الشراء الفعلي", delivery: "سجل التسليم",
    history: "سجل سير العمل", budget: "سجل الميزانية", supplier: "المورد",
    shipTo: "عنوان التسليم", items: "الأصناف", totals: "الإجماليات", warnings: "تنبيهات الإرسال",
    name: "الصنف", sku: "الرمز", quantity: "الكمية", unit: "الوحدة", price: "سعر الوحدة",
    charge: "الرسوم", total: "الإجمالي", date: "التاريخ", event: "الحدث", evidence: "الإثبات",
    yes: "نعم", no: "لا", noValue: "غير مسجل", page: "صفحة", of: "من", checksum: "بصمة المستند",
  },
  ms: {
    approvedTitle: "Permintaan Pembelian Diluluskan",
    finalTitle: "Rekod Pemenuhan dan Penghantaran Akhir",
    poTitle: "Pesanan Pembelian Pembekal",
    reference: "Rujukan", version: "Versi", status: "Status", generated: "Dijana",
    organization: "Organisasi", request: "Butiran permintaan", approval: "Sejarah kelulusan",
    estimate: "Anggaran diluluskan", actual: "Pembelian sebenar", delivery: "Rekod penghantaran",
    history: "Sejarah aliran kerja", budget: "Rekod bajet", supplier: "Pembekal",
    shipTo: "Hantar kepada", items: "Item", totals: "Jumlah", warnings: "Amaran penghantaran",
    name: "Item", sku: "SKU", quantity: "Kuantiti", unit: "Unit", price: "Harga unit",
    charge: "Caj", total: "Jumlah", date: "Tarikh", event: "Peristiwa", evidence: "Bukti",
    yes: "Ya", no: "Tidak", noValue: "Tidak direkodkan", page: "Halaman", of: "daripada", checksum: "Checksum dokumen",
  },
};

function normalizedKey(value) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasForbiddenKey(value, forbidden) {
  if (Array.isArray(value)) return value.some((item) => hasForbiddenKey(item, forbidden));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => (
    [...forbidden].some((term) => normalizedKey(key).startsWith(term))
      || hasForbiddenKey(item, forbidden)
  ));
}

export function assertSafeDocumentSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw new Error("The document snapshot is invalid.");
  }
  const type = snapshot.documentType;
  if (!["APPROVED_REQUEST", "FINAL_FULFILMENT_DELIVERY", "SUPPLIER_PURCHASE_ORDER"].includes(type)) {
    throw new Error("The document type is invalid.");
  }
  const forbidden = new Set([
    ...FORBIDDEN.common,
    ...(type === "SUPPLIER_PURCHASE_ORDER" ? FORBIDDEN.supplier : FORBIDDEN.customer),
  ]);
  if (hasForbiddenKey(snapshot, forbidden)) {
    throw new Error("The document snapshot contains a forbidden field.");
  }
  return snapshot;
}

function display(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function localeTag(locale) {
  if (locale === "ar") return "ar-SA";
  if (locale === "ms") return "ms-MY";
  return "en-MY";
}

function formatDate(value, locale, timezone, fallback) {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return display(value, fallback);
  return new Intl.DateTimeFormat(localeTag(locale), {
    dateStyle: "medium", timeStyle: "short", timeZone: timezone || "UTC",
  }).format(parsed);
}

function formatNumber(value, locale, currency) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "-";
  if (currency) {
    if (locale === "ar") {
      const amount = new Intl.NumberFormat(localeTag(locale), {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      }).format(parsed).replace(/[\u061c\u200e\u200f]/g, "");
      const currencyName = currency === "MYR" ? "ر.م." : (
        new Intl.DisplayNames([localeTag(locale)], { type: "currency" }).of(currency) ?? currency
      );
      return `${amount} ${currencyName}`;
    }
    const formatter = new Intl.NumberFormat(localeTag(locale), {
      style: "currency", currency, maximumFractionDigits: 2,
    });
    return formatter.format(parsed);
  }
  return new Intl.NumberFormat(localeTag(locale), { maximumFractionDigits: 3 }).format(parsed);
}

function factRows(object, labels, fallback) {
  return labels
    .map(([label, key]) => [label, display(object?.[key], fallback)])
    .filter(([, value]) => value !== fallback);
}

export function buildDocumentSections(snapshotInput) {
  const snapshot = assertSafeDocumentSnapshot(snapshotInput);
  const locale = COPY[snapshot.locale] ? snapshot.locale : "en";
  const copy = COPY[locale];
  const timezone = snapshot.timezone || "UTC";
  const rtl = locale === "ar";
  if (snapshot.documentType === "SUPPLIER_PURCHASE_ORDER") {
    const po = snapshot.purchaseOrder ?? {};
    return {
      locale, rtl, copy, timezone, title: copy.poTitle,
      subtitle: `${copy.reference}: ${display(po.reference, copy.noValue)} · ${copy.version}: ${display(po.requestVersion, copy.noValue)}`,
      sections: [
        { kind: "facts", title: copy.supplier, rows: factRows(snapshot.supplier, [
          [copy.name, "name"], [copy.reference, "code"], [copy.request, "address"], [copy.status, "terms"],
        ], copy.noValue) },
        { kind: "facts", title: copy.shipTo, rows: factRows(snapshot.shipTo, [
          [copy.organization, "company"], [copy.request, "branch"], [copy.delivery, "address"], [copy.evidence, "instructions"],
        ], copy.noValue) },
        { kind: "table", title: copy.items, columns: [
          { key: "sku", label: copy.sku, width: 70 },
          { key: "name", label: copy.name, width: 168 },
          { key: "quantity", label: copy.quantity, width: 55 },
          { key: "unitOfMeasure", label: copy.unit, width: 54 },
          { key: "supplierUnitPrice", label: copy.price, width: 83, money: true },
          { key: "lineTotal", label: copy.total, width: 83, money: true },
        ], rows: snapshot.lines ?? [], currency: po.currency },
        { kind: "facts", title: copy.totals, rows: factRows(snapshot.totals, [
          [copy.total, "subtotal"], [copy.charge, "delivery"], [copy.unit, "currency"],
        ], copy.noValue) },
        ...(snapshot.warnings?.length ? [{ kind: "list", title: copy.warnings, rows: snapshot.warnings }] : []),
        { kind: "paragraph", title: copy.status, text: snapshot.terms },
      ],
    };
  }
  const request = snapshot.request ?? {};
  const common = {
    locale, rtl, copy, timezone,
    subtitle: `${copy.reference}: ${display(request.reference, copy.noValue)} · ${copy.version}: ${display(request.version, copy.noValue)}`,
  };
  const originalColumns = [
    { key: "sku", label: copy.sku, width: 70 },
    { key: "name", label: copy.name, width: 190 },
    { key: "quantity", label: copy.quantity, width: 62 },
    { key: "unitOfMeasure", label: copy.unit, width: 60 },
    { key: "unitSellPrice", label: copy.price, width: 86, money: true },
    { key: "lineTotal", label: copy.total, width: 82, money: true },
  ];
  const requestFacts = { kind: "facts", title: copy.request, rows: [
    [copy.organization, request.company?.legalName || request.company?.name],
    [copy.request, [request.branch?.name, request.department?.name, request.costCentre?.name].filter(Boolean).join(" · ")],
    [copy.generated, formatDate(snapshot.capturedAt, locale, timezone, copy.noValue)],
    [copy.date, display(request.neededByDate, copy.noValue)],
    [copy.status, display(request.status, copy.noValue)],
  ].filter(([, value]) => value) };
  if (snapshot.documentType === "APPROVED_REQUEST") {
    return {
      ...common, title: copy.approvedTitle,
      sections: [
        requestFacts,
        { kind: "table", title: copy.items, columns: originalColumns, rows: snapshot.lines ?? [], currency: request.currency },
        { kind: "facts", title: copy.totals, rows: Object.entries(snapshot.totals ?? {}).map(([key, value]) => [key, display(value, copy.noValue)]) },
        { kind: "timeline", title: copy.approval, rows: snapshot.approval?.decisions ?? [], timezone },
        ...(snapshot.budget ? [{ kind: "facts", title: copy.budget, rows: Object.entries(snapshot.budget).map(([key, value]) => [key, display(value, copy.noValue)]) }] : []),
        { kind: "paragraph", title: copy.status, text: snapshot.disclaimer },
      ],
    };
  }
  const actualColumns = [
    { key: "actualSku", label: copy.sku, width: 70 },
    { key: "actualName", label: copy.name, width: 174 },
    { key: "quantity", label: copy.quantity, width: 58 },
    { key: "unitOfMeasure", label: copy.unit, width: 54 },
    { key: "customerUnitPrice", label: copy.price, width: 90, money: true },
    { key: "lineTotal", label: copy.total, width: 84, money: true },
  ];
  return {
    ...common, title: copy.finalTitle,
    sections: [
      requestFacts,
      { kind: "table", title: copy.estimate, columns: originalColumns, rows: snapshot.original?.lines ?? [], currency: request.currency },
      { kind: "table", title: copy.actual, columns: actualColumns, rows: snapshot.actual?.lines ?? [], currency: request.currency },
      { kind: "facts", title: copy.actual, rows: factRows({
        ...snapshot.actual,
        withinTolerance: typeof snapshot.actual?.withinTolerance === "boolean"
          ? (snapshot.actual.withinTolerance ? copy.yes : copy.no)
          : snapshot.actual?.withinTolerance,
      }, [
        [copy.total, "actualAmount"], [copy.estimate, "estimateAmount"], [copy.status, "withinTolerance"], [copy.evidence, "receiptReference"],
      ], copy.noValue) },
      { kind: "facts", title: copy.delivery, rows: factRows(snapshot.delivery, [
        [copy.reference, "reference"], [copy.status, "status"], [copy.shipTo, "address"], [copy.delivery, "agentName"], [copy.evidence, "recipientName"],
      ], copy.noValue) },
      { kind: "timeline", title: copy.delivery, rows: snapshot.delivery?.timeline ?? [], timezone },
      { kind: "evidence", title: copy.evidence, rows: snapshot.delivery?.evidence ?? [], timezone },
      { kind: "timeline", title: copy.history, rows: snapshot.history ?? [], timezone },
      ...(snapshot.budget ? [{ kind: "facts", title: copy.budget, rows: Object.entries(snapshot.budget).map(([key, value]) => [key, display(value, copy.noValue)]) }] : []),
      { kind: "paragraph", title: copy.status, text: snapshot.disclaimer },
    ],
  };
}

async function normalizedLogo(bytes, contentType) {
  if (!bytes) return null;
  const value = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (contentType === "image/webp") return sharp(value).png().toBuffer();
  if (["image/png", "image/jpeg"].includes(contentType)) return value;
  return null;
}

export async function renderVersionedDocument({ snapshot, companyLogo, companyLogoContentType }) {
  const model = buildDocumentSections(snapshot);
  const tenantLogo = await normalizedLogo(companyLogo, companyLogoContentType);
  const capturedAt = new Date(snapshot.capturedAt || "2026-01-01T00:00:00.000Z");
  const chunks = [];
  const document = new PDFDocument({
    size: "A4", margin: PAGE.margin, bufferPages: true, tagged: true,
    displayTitle: true, lang: localeTag(model.locale), autoFirstPage: false,
    info: {
      Title: model.title, Author: "Axora", Subject: model.subtitle,
      Creator: "Axora versioned document service",
      CreationDate: capturedAt, ModificationDate: capturedAt,
    },
  });
  const axoraLogo = document.openImage(AXORA_LOGO);
  const tenantLogoImage = tenantLogo ? document.openImage(tenantLogo) : null;
  document.on("data", (chunk) => chunks.push(chunk));
  const completed = new Promise((resolve, reject) => {
    document.once("end", () => resolve(Buffer.concat(chunks)));
    document.once("error", reject);
  });
  document.registerFont("AxoraRegular", REGULAR_FONT);
  document.registerFont("AxoraBold", BOLD_FONT);
  const contentWidth = PAGE.width - PAGE.margin * 2;
  const align = model.rtl ? "right" : "left";

  function drawChrome() {
    document.save();
    document.image(axoraLogo, PAGE.margin, 26, { fit: [88, 34], align: "left" });
    if (tenantLogoImage) document.image(tenantLogoImage, PAGE.width - PAGE.margin - 76, 24, { fit: [76, 38], align: "right" });
    document.moveTo(PAGE.margin, 70).lineTo(PAGE.width - PAGE.margin, 70).lineWidth(0.7).strokeColor("#b7c0c8").stroke();
    document.restore();
    document.y = PAGE.header;
  }

  function addPage() {
    document.addPage({ size: "A4", margin: PAGE.margin });
  }

  function ensureSpace(height) {
    if (document.y + height > PAGE.height - PAGE.footer - PAGE.margin) addPage();
  }

  function heading(value) {
    const text = display(value, model.copy.noValue);
    document.font("AxoraBold").fontSize(12);
    const height = document.heightOfString(text, { width: contentWidth, align });
    ensureSpace(height + 17);
    const y = document.y + 7;
    document.fillColor("#173f4f").text(text, PAGE.margin, y, { width: contentWidth, align });
    document.y = y + height + 6;
  }

  function facts(rows) {
    for (const [label, value] of rows) {
      const labelWidth = 150;
      const text = display(value, model.copy.noValue);
      const height = Math.max(
        document.font("AxoraBold").fontSize(8.5).heightOfString(String(label), { width: labelWidth }),
        document.font("AxoraRegular").fontSize(9).heightOfString(text, { width: contentWidth - labelWidth - 10 }),
      ) + 7;
      ensureSpace(height);
      const y = document.y;
      document.font("AxoraBold").fontSize(8.5).fillColor("#52636b").text(String(label), PAGE.margin, y, { width: labelWidth, align });
      document.font("AxoraRegular").fontSize(9).fillColor("#17272e").text(text, PAGE.margin + labelWidth + 10, y, { width: contentWidth - labelWidth - 10, align });
      document.y = y + height;
    }
  }

  function table(section) {
    const columns = section.columns;
    const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
    const scale = contentWidth / totalWidth;
    const widths = columns.map((column) => column.width * scale);
    const drawHeader = () => {
      ensureSpace(26);
      const y = document.y;
      document.rect(PAGE.margin, y, contentWidth, 23).fill("#173f4f");
      let x = PAGE.margin;
      columns.forEach((column, index) => {
        document.font("AxoraBold").fontSize(7.4).fillColor("#ffffff")
          .text(column.label, x + 4, y + 6, { width: widths[index] - 8, align });
        x += widths[index];
      });
      document.y = y + 25;
    };
    drawHeader();
    for (const [rowIndex, row] of (section.rows ?? []).entries()) {
      const values = columns.map((column) => {
        if (column.money) return formatNumber(row[column.key], model.locale, section.currency);
        return display(row[column.key], model.copy.noValue);
      });
      const heights = values.map((value, index) => document.font("AxoraRegular").fontSize(7.8)
        .heightOfString(value, { width: widths[index] - 8 }));
      const rowHeight = Math.max(22, ...heights) + 8;
      if (document.y + rowHeight > PAGE.height - PAGE.footer - PAGE.margin) {
        addPage();
        drawHeader();
      }
      const y = document.y;
      if (rowIndex % 2) document.rect(PAGE.margin, y, contentWidth, rowHeight).fill("#f3f6f5");
      let x = PAGE.margin;
      values.forEach((value, index) => {
        document.font("AxoraRegular").fontSize(7.8).fillColor("#17272e")
          .text(value, x + 4, y + 5, { width: widths[index] - 8, align });
        x += widths[index];
      });
      document.y = y + rowHeight;
    }
  }

  document.on("pageAdded", drawChrome);
  addPage();
  document.font("AxoraBold").fontSize(20).fillColor("#102f3b")
    .text(model.title, PAGE.margin, document.y, { width: contentWidth, align });
  document.moveDown(0.25).font("AxoraRegular").fontSize(9).fillColor("#52636b")
    .text(model.subtitle, PAGE.margin, document.y, { width: contentWidth, align });
  document.moveDown(0.55);

  for (const section of model.sections) {
    if (["facts", "table", "list", "timeline", "evidence"].includes(section.kind)
      && !(section.rows?.length)) continue;
    if (section.kind === "paragraph"
      && (section.text === null || section.text === undefined || section.text === "")) continue;
    heading(section.title);
    if (section.kind === "facts") facts(section.rows);
    if (section.kind === "table") table(section);
    if (section.kind === "paragraph") {
      const text = display(section.text, model.copy.noValue);
      document.font("AxoraRegular").fontSize(9);
      const height = document.heightOfString(text, { width: contentWidth, align, lineGap: 2 });
      ensureSpace(height + 5);
      document.fillColor("#17272e").text(text, PAGE.margin, document.y, {
        width: contentWidth, align, lineGap: 2,
      });
    }
    if (section.kind === "list") facts(section.rows.map((value, index) => [`${index + 1}`, value]));
    if (section.kind === "timeline") facts(section.rows.map((row) => [
      display(row.action || row.event || row.type || row.stateAfter, model.copy.event),
      formatDate(row.occurredAt || row.recordedAt || row.decidedAt, model.locale, model.timezone, model.copy.noValue),
    ]));
    if (section.kind === "evidence") facts(section.rows.map((row) => [
      display(row.type, model.copy.evidence),
      `${display(row.reference, model.copy.noValue)} · ${formatDate(row.capturedAt, model.locale, model.timezone, model.copy.noValue)}`,
    ]));
  }

  const range = document.bufferedPageRange();
  for (let pageIndex = 0; pageIndex < range.count; pageIndex += 1) {
    document.switchToPage(pageIndex);
    const footer = `${model.copy.page} ${pageIndex + 1} ${model.copy.of} ${range.count}`;
    document.font("AxoraRegular").fontSize(7.5).fillColor("#66757c")
      .text(footer, PAGE.margin, PAGE.height - PAGE.margin - 11, {
        width: contentWidth, align: "center", lineBreak: false,
      });
  }
  document.end();
  return { bytes: await completed, pageCount: range.count, model };
}
