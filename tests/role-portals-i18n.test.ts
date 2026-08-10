import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: {
    id: "00000000-0000-4000-8000-000000000001",
    email: "portal@example.test",
    name: "Portal user",
    role: "DELIVERY_DRIVER",
    accountKind: "DELIVERY",
    scopeType: "DELIVERY",
    isOwner: false,
    authVersion: 1,
    preferredLocale: "en",
  } as Record<string, unknown>,
  getReceivingWorkspace: vi.fn(),
  getDriverWorkspace: vi.fn(),
  canAccess: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  requirePagePermission: vi.fn(async () => mocks.actor),
}));

vi.mock("@/lib/role-portals-repository", () => ({
  getReceivingWorkspace: mocks.getReceivingWorkspace,
  getDriverWorkspace: mocks.getDriverWorkspace,
}));

vi.mock("@/lib/permissions", () => ({ canAccess: mocks.canAccess }));

import DriverPage from "@/app/(portal)/driver/page";
import ReceivingPage from "@/app/(portal)/receiving/page";
import { deliveryWorkflowMessages, deliveryWorkflowStatusLabel } from "@/lib/delivery-workflow-i18n";
import {
  ROLE_PORTAL_MESSAGES,
  formatRolePortalDate,
  formatRolePortalMoney,
  formatRolePortalStatus,
} from "@/lib/role-portals-i18n";

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
      expect(copy.driver.evidenceHint).toBeTruthy();
      expect(copy.driver.queueRecoveryTitle).toBeTruthy();
      expect(copy.driver.exportQueueRecovery).toBeTruthy();
      expect(copy.driver.confirmDiscard).toBeTruthy();
      expect(copy.receiving.confirmReceipt).toBeTruthy();
      expect(Object.keys(copy.driver.eventLabels)).toHaveLength(10);
      const deliveryCopy = deliveryWorkflowMessages(locale);
      for (const key of ["accept", "reject", "startShopping", "outForDelivery", "arrived", "partial", "delivered", "completed", "reportIssue", "uploadProof"] as const) {
        expect(deliveryCopy[key]).toBeTruthy();
      }
    }
    expect(deliveryWorkflowStatusLabel("OUT_FOR_DELIVERY", "ms")).toBe("Keluar untuk penghantaran");
  });

  it("renders the mobile driver workflow in Malay", async () => {
    mocks.actor.preferredLocale = "ms";
    const html = renderToStaticMarkup(await DriverPage());

    expect(html).toContain("Ruang kerja pemandu");
    expect(html).toContain("Penghantaran ditugaskan");
    expect(html).toContain("Larian pemenuhan");
    expect(html).toContain("Muat semula");
    expect(html).toContain("Memuatkan ruang kerja penghantaran");
    expect(html).not.toContain("Loading delivery workspace");
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
