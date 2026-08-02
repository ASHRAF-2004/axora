import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "portal@example.test",
    name: "Portal user",
    role: "SUPPLIER_USER",
    accountKind: "SUPPLIER",
    scopeType: "SUPPLIER",
    supplierId: "10000000-0000-4000-8000-000000000001",
    isOwner: false,
    authVersion: 1,
    preferredLocale: "en",
  } as Record<string, unknown>,
  getSupplierWorkspace: vi.fn(),
  getReceivingWorkspace: vi.fn(),
  getDriverWorkspace: vi.fn(),
  canAccess: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requirePagePermission: vi.fn(async () => mocks.actor),
}));

vi.mock("@/lib/role-portals-repository", () => ({
  getSupplierWorkspace: mocks.getSupplierWorkspace,
  getReceivingWorkspace: mocks.getReceivingWorkspace,
  getDriverWorkspace: mocks.getDriverWorkspace,
}));

vi.mock("@/lib/permissions", () => ({ canAccess: mocks.canAccess }));

import DriverPage from "@/app/(portal)/driver/page";
import ReceivingPage from "@/app/(portal)/receiving/page";
import SupplierPage from "@/app/(portal)/supplier/page";
import {
  ROLE_PORTAL_MESSAGES,
  formatRolePortalDate,
  formatRolePortalMoney,
  formatRolePortalStatus,
} from "@/lib/role-portals-i18n";

const supplierWorkspace = {
  supplierName: "Pembekal Contoh",
  rfqs: [{
    id: "20000000-0000-4000-8000-000000000001",
    companyId: "30000000-0000-4000-8000-000000000001",
    reference: "RFQ-1001",
    status: "ACKNOWLEDGED",
    respondBy: "2026-08-12T09:00:00.000Z",
    productName: "Safety gloves",
    specification: "Powder-free",
    quantity: 12.5,
    unit: "box",
    documents: [{
      id: "40000000-0000-4000-8000-000000000001",
      fileName: "request.pdf",
      documentKind: "RFQ",
      documentVersion: 1,
      createdAt: "2026-08-01T09:00:00.000Z",
    }],
  }],
};

const deliveryJob = {
  id: "50000000-0000-4000-8000-000000000001",
  companyId: "30000000-0000-4000-8000-000000000001",
  branchId: "60000000-0000-4000-8000-000000000001",
  assignmentId: "70000000-0000-4000-8000-000000000001",
  jobCode: "DLV-1001",
  status: "ASSIGNED",
  assignmentStatus: "ASSIGNED",
  branchName: "Central branch",
  address: "10 Example Street",
  contactName: "Receiver",
  contactPhone: "+60123456789",
  instructions: "Call on arrival",
  windowStart: "2026-08-12T09:00:00.000Z",
  windowEnd: "2026-08-12T12:00:00.000Z",
  packageSummary: "Safety gloves × 12.5 box",
  lines: [{
    id: "80000000-0000-4000-8000-000000000001",
    productName: "Safety gloves",
    plannedQuantity: 12.5,
    unit: "box",
  }],
};

const receivingJob = {
  id: deliveryJob.id,
  companyId: deliveryJob.companyId,
  branchId: deliveryJob.branchId,
  jobCode: deliveryJob.jobCode,
  branchName: deliveryJob.branchName,
  deliveredAt: "2026-08-12T10:00:00.000Z",
  lines: [{
    id: "80000000-0000-4000-8000-000000000001",
    requestLineId: "90000000-0000-4000-8000-000000000001",
    productName: "Safety gloves",
    plannedQuantity: 12.5,
    unit: "box",
  }],
};

describe("localized role portals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.actor.preferredLocale = "en";
    mocks.getSupplierWorkspace.mockResolvedValue(supplierWorkspace);
    mocks.getDriverWorkspace.mockResolvedValue([deliveryJob]);
    mocks.getReceivingWorkspace.mockResolvedValue([receivingJob]);
    mocks.canAccess.mockReturnValue(true);
  });

  it("provides complete supported-language catalogs and locale-aware formatters", () => {
    expect(Object.keys(ROLE_PORTAL_MESSAGES)).toEqual(["en", "ar", "ms"]);
    expect(formatRolePortalStatus("EN_ROUTE", "ar")).toBe("في الطريق");
    expect(formatRolePortalStatus("ACKNOWLEDGED", "ms")).toBe("Diakui");
    expect(formatRolePortalDate("2026-08-12T09:00:00.000Z", "ms")).toContain("2026");
    expect(formatRolePortalMoney(1250.5, "ms")).toContain("1,250.50");
    for (const locale of ["en", "ar", "ms"] as const) {
      const copy = ROLE_PORTAL_MESSAGES[locale];
      expect(copy.supplier.submitVersioned).toBeTruthy();
      expect(copy.driver.evidenceHint).toBeTruthy();
      expect(copy.driver.queueRecoveryTitle).toBeTruthy();
      expect(copy.driver.exportQueueRecovery).toBeTruthy();
      expect(copy.driver.confirmDiscard).toBeTruthy();
      expect(copy.receiving.confirmReceipt).toBeTruthy();
      expect(Object.keys(copy.driver.eventLabels)).toHaveLength(10);
    }
  });

  it("renders the complete supplier workflow in Arabic", async () => {
    mocks.actor.preferredLocale = "ar";
    const html = renderToStaticMarkup(await SupplierPage({
      searchParams: Promise.resolve({ notice: "acknowledgement-recorded" }),
    }));

    expect(html).toContain("مساحة عمل المورد");
    expect(html).toContain("تم تسجيل ردك على طلب عرض السعر");
    expect(html).toContain("تأكيد الطلب أو طلب استيضاح");
    expect(html).toContain("تقديم عرض سعر");
    expect(html).toContain("رفع مستند عرض السعر");
    expect(html).not.toContain("Acknowledge or query RFQ");
    expect(html).not.toContain("Submit versioned quotation");
  });

  it("renders the mobile driver workflow in Malay", async () => {
    mocks.actor.preferredLocale = "ms";
    const html = renderToStaticMarkup(await DriverPage());

    expect(html).toContain("Ruang kerja pemandu");
    expect(html).toContain("Penghantaran ditugaskan");
    expect(html).toContain("Dalam perjalanan");
    expect(html).toContain("Buka navigasi");
    expect(html).toContain("Rekod hasil serahan");
    expect(html).toContain("Lapor isu");
    expect(html).toContain("Tambah nota pemandu");
    expect(html).toContain("Muat naik bukti pemandu");
    expect(html).toContain('aria-label="Kemas kini DLV-1001"');
    expect(html).not.toContain("No status recorded yet");
  });

  it("renders independent receiving controls and explanations in Malay", async () => {
    mocks.actor.preferredLocale = "ms";
    const html = renderToStaticMarkup(await ReceivingPage({
      searchParams: Promise.resolve({ notice: "receipt-confirmed" }),
    }));

    expect(html).toContain("Penerimaan pelanggan");
    expect(html).toContain("Penerimaan disahkan dan direkodkan secara berasingan daripada bukti pemandu");
    expect(html).toContain("Periksa semua 1 baris");
    expect(html).toContain("Klasifikasi pemeriksaan");
    expect(html).toContain("Sahkan penerimaan pelanggan");
    expect(html).not.toContain("Driver photos and delivery notes");
    expect(html).not.toContain("Confirm customer receipt");
  });
});
