import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`); }),
  requirePermission: vi.fn(),
  requireRecentStepUp: vi.fn(),
  updateRequestStatus: vi.fn(),
  recordApproval: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", () => ({
  requirePermission: mocks.requirePermission,
  requireRecentStepUp: mocks.requireRecentStepUp,
}));
vi.mock("@/lib/locale-server", () => ({ requestLocaleDecision: vi.fn(async () => ({ locale: "en", explicit: true })) }));
vi.mock("@/lib/repository", () => ({ createBranch: vi.fn(), createProduct: vi.fn(), createSupplier: vi.fn(), setMasterActive: vi.fn(), createCompany: vi.fn(), createRequest: vi.fn(), updateRequestStatus: mocks.updateRequestStatus }));
vi.mock("@/lib/tenant-branding", () => ({ createCompanyWithBrand: vi.fn(), regenerateCompanyBrand: vi.fn() }));
vi.mock("@/lib/product-admin", () => ({ updateProduct: vi.fn() }));
vi.mock("@/lib/product-delete", () => ({ deleteProduct: vi.fn() }));
vi.mock("@/lib/product-images", () => ({ deactivateProductImage: vi.fn(), prepareProductImages: vi.fn(async () => []), savePreparedProductImages: vi.fn(), saveProductImages: vi.fn(), setPrimaryProductImage: vi.fn(), updateProductImageAltText: vi.fn() }));
vi.mock("@/lib/scoped-operations", () => ({
  createScopedInvoice: vi.fn(),
  createScopedQuotation: vi.fn(),
  issueScopedSupplierRfq: vi.fn(),
  recordScopedApproval: mocks.recordApproval,
  recordScopedDelivery: vi.fn(),
  recordScopedPayment: vi.fn(),
  selectScopedQuotation: vi.fn(),
}));

import { addProductImagesAction, createCompanyAction, regenerateCompanyBrandAction, replaceProductImageAction } from "@/app/(portal)/masters/actions";
import { recordApprovalAction } from "@/app/(portal)/operations/actions";
import { updateStatusAction } from "@/app/(portal)/requests/actions";
import { ACTION_FEEDBACK_CODES, ACTION_FEEDBACK_MESSAGES, publicApprovalErrorCode } from "@/lib/action-feedback-i18n";
import { CORE_PORTAL_MESSAGES } from "@/lib/core-portal-i18n";

const actor = { id: "10000000-0000-4000-8000-000000000001", email: "approver@example.test", name: "Approver", role: "BRANCH_APPROVER", accountKind: "COMPANY", isOwner: false, authVersion: 1, preferredLocale: "ar" };
const requestId = "20000000-0000-4000-8000-000000000001";

describe("localized portal action feedback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePermission.mockResolvedValue(actor);
    mocks.requireRecentStepUp.mockResolvedValue(undefined);
    mocks.recordApproval.mockResolvedValue(undefined);
  });

  it("keeps every stable approval code translated in all supported locales", () => {
    for (const locale of ["en", "ar", "ms"] as const) {
      expect(Object.keys(ACTION_FEEDBACK_MESSAGES[locale]).sort()).toEqual([...ACTION_FEEDBACK_CODES].sort());
    }
    expect(publicApprovalErrorCode("You cannot approve your own purchase request.")).toBe("approval.self_approval");
    expect(ACTION_FEEDBACK_MESSAGES.ar["approval.reason_required"]).toContain("سبباً");
  });

  it("redirects invalid file and status submissions with stable notice codes", async () => {
    await expect(createCompanyAction(new FormData())).rejects.toThrow("REDIRECT:/companies?notice=company-logo-required");
    await expect(regenerateCompanyBrandAction("company-1", new FormData())).rejects.toThrow("REDIRECT:/companies?notice=company-logo-required");
    await expect(addProductImagesAction("product-1", new FormData())).rejects.toThrow("REDIRECT:/products/product-1/edit?notice=product-image-required");
    await expect(replaceProductImageAction("product-1", new FormData())).rejects.toThrow("REDIRECT:/products/product-1/edit?notice=product-image-required");

    const statusData = new FormData();
    statusData.set("status", "NOT_A_CANONICAL_STATUS");
    await expect(updateStatusAction("request-1", statusData)).rejects.toThrow("REDIRECT:/requests/request-1?notice=request-status-invalid");
    expect(mocks.updateRequestStatus).not.toHaveBeenCalled();
  });

  it("renders redirect notices in EN, AR and MS", () => {
    for (const code of ["company-logo-required", "product-image-required", "request-status-invalid"]) {
      expect(CORE_PORTAL_MESSAGES.en.notices[code]?.message).toBeTruthy();
      expect(CORE_PORTAL_MESSAGES.ar.notices[code]?.message).toBeTruthy();
      expect(CORE_PORTAL_MESSAGES.ms.notices[code]?.message).toBeTruthy();
      expect(CORE_PORTAL_MESSAGES.ar.notices[code]?.message).not.toBe(CORE_PORTAL_MESSAGES.en.notices[code]?.message);
    }
  });

  it("returns localized approval validation, domain errors, and success", async () => {
    const rejected = new FormData();
    rejected.set("requestId", requestId);
    rejected.set("status", "Rejected");
    const validation = await recordApprovalAction({ status: "idle", message: "", submissionId: 0 }, rejected);
    expect(validation.status).toBe("error");
    expect(validation.field).toBe("reason");
    expect(validation.message).toBe(ACTION_FEEDBACK_MESSAGES.ar["approval.reason_required"]);

    mocks.recordApproval.mockRejectedValueOnce(new Error("You cannot approve your own purchase request."));
    const approved = new FormData();
    approved.set("requestId", requestId);
    approved.set("status", "Approved");
    const domain = await recordApprovalAction({ status: "idle", message: "", submissionId: 0 }, approved);
    expect(domain.message).toBe(ACTION_FEEDBACK_MESSAGES.ar["approval.self_approval"]);

    const success = await recordApprovalAction({ status: "idle", message: "", submissionId: 0 }, approved);
    expect(success.status).toBe("success");
    expect(success.message).toBe(ACTION_FEEDBACK_MESSAGES.ar["approval.approved"]);
  });
});
