import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import type { CompanyAdminDirectPurchaseResult, CompanyAdminDirectPurchaseWorkspace } from "@/lib/company-admin-direct-purchase";
import type { ProcurementCartSnapshot } from "@/lib/procurement-cart";
import { parseMoneyDecimal } from "@/lib/money-decimal";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(), place: vi.fn(), workspace: vi.fn(), revalidatePath: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ requirePermission: mocks.requirePermission }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/company-admin-direct-purchase", async (original) => ({
  ...await original<typeof import("@/lib/company-admin-direct-purchase")>(),
  placeCompanyAdminDirectPurchase: mocks.place,
  getCompanyAdminDirectPurchaseWorkspace: mocks.workspace,
}));
import { runCompanyAdminDirectPurchaseAction } from "@/app/(portal)/cart/actions";

const actor = {
  id: "bc000000-0000-4000-8000-000000000001", roleAssignmentId: "bc000000-0000-4000-8000-000000000002",
  companyId: "bc000000-0000-4000-8000-000000000003", email: "admin@fixture.invalid", name: "Fixture administrator",
  role: "COMPANY_ADMIN", accountKind: "COMPANY", scopeType: "COMPANY", isOwner: false, authVersion: 1,
} satisfies AuthenticatedSessionUser;
const command = { cartId: "cart-fixture", expectedCartVersion: 2, commandId: "bc000000-0000-4000-8000-000000000004" };
function cart(): ProcurementCartSnapshot {
  return { id: command.cartId, companyId: actor.companyId, branchId: "branch-fixture", version: 3, status: "ACTIVE",
    updatedAt: "2026-10-08T00:00:00.000Z", items: [{
      publicRef: "public-sticky-notes", name: "Sticky notes", category: "Stationery", subcategory: "Notes", unit: "pack",
      unitPrice: "4.40", displayedUnitPrice: "4.40", priceRuleVersion: 1, displayedPriceRuleVersion: 1,
      currency: "MYR", deliverySlaDays: 2, hasImage: false, quantity: 2, specification: "",
      available: true, categoryAllowed: true, repriced: false, lineTotal: "8.80",
    }] };
}
function workspace(): CompanyAdminDirectPurchaseWorkspace {
  return { capturedAt: new Date("2026-10-08T00:00:00.000Z"), companyId: actor.companyId,
    branchId: "branch-fixture", branchCode: "TEST", branchName: "Fixture branch",
    cartId: command.cartId, cartVersion: 3, cart: cart(), currency: "MYR",
    subtotal: parseMoneyDecimal("8.80"), deliveryFee: parseMoneyDecimal("0.00"), taxAmount: parseMoneyDecimal("0.00"),
    orderTotal: parseMoneyDecimal("8.80"), budgetAvailable: parseMoneyDecimal("100.00"), walletAvailable: parseMoneyDecimal("200.00"),
    budgetReady: true, locationReady: true, priceChanged: false };
}
function stale(): Extract<CompanyAdminDirectPurchaseResult, { status: "STALE_CART" }> {
  return { status: "STALE_CART", ...command, created: false, currentCartVersion: 3, cart: cart() };
}
function receipt(status: "SUCCESS" | "ALREADY_PROCESSED" | "CART_ALREADY_PURCHASED"): CompanyAdminDirectPurchaseResult {
  return { status, commandId: command.commandId, cartId: command.cartId, created: status === "SUCCESS",
    consumedCartVersion: 2, requestId: "request-fixture", orderReference: "ORDER-FIXTURE",
    invoiceId: "invoice-fixture", invoiceNumber: "INVOICE-FIXTURE", paymentId: "payment-fixture",
    deliveryJobId: "delivery-fixture", deliveryStatus: "AWAITING_ASSIGNMENT", branchId: "branch-fixture",
    branchCode: "TEST", branchName: "Fixture branch", amount: parseMoneyDecimal("4.40"), currency: "MYR",
    correlationId: command.commandId };
}

describe("known-stale direct-purchase action workspace envelope", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.requirePermission.mockReset(); mocks.place.mockReset(); mocks.workspace.mockReset();
    mocks.requirePermission.mockResolvedValue(actor);
    mocks.place.mockResolvedValue(stale()); mocks.workspace.mockResolvedValue(workspace());
  });
  it("reads the existing authorized workspace once for the refused Cart's exact version without replaying the purchase", async () => {
    const result = stale(); const pair = workspace();
    mocks.place.mockResolvedValue(result); mocks.workspace.mockResolvedValue(pair);
    expect(await runCompanyAdminDirectPurchaseAction(command)).toEqual({ ok: true, result, staleWorkspace: pair });
    expect(mocks.requirePermission).toHaveBeenCalledExactlyOnceWith("direct_purchase");
    expect(mocks.place).toHaveBeenCalledExactlyOnceWith(actor, command);
    expect(mocks.workspace).toHaveBeenCalledExactlyOnceWith(actor, { id: command.cartId, version: 3 });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cart");
  });
  it.each(["denied", "raced", "unavailable"])("preserves the known STALE refusal when the optional read is %s", async (reason) => {
    const result = stale(); mocks.place.mockResolvedValue(result); mocks.workspace.mockRejectedValue(new Error(reason));
    expect(await runCompanyAdminDirectPurchaseAction(command)).toEqual({ ok: true, result });
    expect(mocks.place).toHaveBeenCalledOnce(); expect(mocks.workspace).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/cart");
  });
  it.each(["company", "branch", "version", "projection", "self", "currency"])("does not emit a mismatched %s read", async (kind) => {
    const pair = workspace(); const result = stale();
    if (kind === "company") pair.companyId = "different-company";
    if (kind === "branch") pair.branchId = "different-branch";
    if (kind === "version") pair.cartVersion = 4;
    if (kind === "projection") pair.cart.items[0].unitPrice = "5.00";
    if (kind === "self") pair.cart.id = "different-cart";
    if (kind === "currency") pair.currency = "USD";
    mocks.place.mockResolvedValue(result); mocks.workspace.mockResolvedValue(pair);
    expect(await runCompanyAdminDirectPurchaseAction(command)).toEqual({ ok: true, result });
    expect(mocks.place).toHaveBeenCalledOnce(); expect(mocks.workspace).toHaveBeenCalledOnce();
  });
  it.each(["command", "cart", "company", "version", "expected", "created", "department", "submitted", "absent"])("does not read an inconsistent/ineligible %s refusal", async (kind) => {
    const result = stale();
    if (kind === "command") result.commandId = "bc000000-0000-4000-8000-000000000099";
    if (kind === "cart") result.cartId = "different-cart";
    if (kind === "company") result.cart!.companyId = "different-company";
    if (kind === "version") result.currentCartVersion = 4;
    if (kind === "expected") result.expectedCartVersion = 1;
    if (kind === "created") result.created = true;
    if (kind === "department") result.cart!.departmentId = "department";
    if (kind === "submitted") result.cart!.status = "SUBMITTED";
    if (kind === "absent") result.cart = undefined;
    mocks.place.mockResolvedValue(result);
    expect(await runCompanyAdminDirectPurchaseAction(command)).toEqual({ ok: true, result });
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.place).toHaveBeenCalledOnce();
  });
  it.each(["SUCCESS", "ALREADY_PROCESSED", "CART_ALREADY_PURCHASED", "PRICE_CHANGED"] as const)("does not perform a recovery read for %s", async (status) => {
    const result: CompanyAdminDirectPurchaseResult = status === "PRICE_CHANGED"
      ? { ...stale(), status, cart: cart() } : receipt(status);
    mocks.place.mockResolvedValue(result);
    expect(await runCompanyAdminDirectPurchaseAction(command)).toEqual({ ok: true, result });
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.place).toHaveBeenCalledOnce();
  });
  it("does not read or retry an unconfirmed command, and preserves the existing UNAVAILABLE envelope", async () => {
    mocks.place.mockRejectedValue(new Error("transport unavailable"));
    expect(await runCompanyAdminDirectPurchaseAction(command)).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(mocks.workspace).not.toHaveBeenCalled(); expect(mocks.place).toHaveBeenCalledOnce();
  });
  it("retains strict command validation and authentication control flow outside the catch", async () => {
    expect(await runCompanyAdminDirectPurchaseAction({ ...command, orderTotal: "0.00" })).toEqual({ ok: false, code: "UNAVAILABLE" });
    expect(mocks.place).not.toHaveBeenCalled(); expect(mocks.workspace).not.toHaveBeenCalled();
    const redirect = new Error("NEXT_REDIRECT"); mocks.requirePermission.mockRejectedValue(redirect);
    await expect(runCompanyAdminDirectPurchaseAction(command)).rejects.toBe(redirect);
    expect(mocks.place).not.toHaveBeenCalled(); expect(mocks.workspace).not.toHaveBeenCalled();
  });
});
