import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { AuthenticatedSessionUser } from "@/lib/auth";
import { cartMessages } from "@/lib/cart-i18n";
import {
  canPlaceCompanyAdminDirectPurchase,
  companyAdminDirectPurchaseInternals,
  directPurchaseCommandSchema,
  usesCompanyAdministratorDirectPurchase,
} from "@/lib/company-admin-direct-purchase";
import { canAccess } from "@/lib/permissions";
import { requestDetailMessages } from "@/lib/request-detail-i18n";

const companyAdmin = {
  id: "76000000-0000-4000-8000-000000000001",
  email: "company-admin@fixture.invalid",
  name: "Company administrator",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: "76000000-0000-4000-8000-000000000002",
  roleAssignmentId: "76000000-0000-4000-8000-000000000003",
  isOwner: false,
  authVersion: 1,
} satisfies AuthenticatedSessionUser;

describe("Company Administrator direct-purchase application contract", () => {
  it("grants the distinct capability only to an exact Company Administrator", () => {
    expect(canAccess(companyAdmin,"direct_purchase")).toBe(true);
    expect(canPlaceCompanyAdminDirectPurchase(companyAdmin)).toBe(true);
    for (const actor of [
      { ...companyAdmin,role: "BRANCH_ADMIN" as const,scopeType: "BRANCH" as const,branchId: "branch" },
      { ...companyAdmin,role: "REQUESTER" as const,scopeType: "BRANCH" as const,branchId: "branch" },
      { ...companyAdmin,role: "COMPANY_APPROVER" as const },
      { ...companyAdmin,accountKind: "PLATFORM" as const,scopeType: "PLATFORM" as const,companyId: undefined,isOwner: true,role: "PLATFORM_OWNER" as const },
      { ...companyAdmin,effectivePermissions: [] },
    ]) {
      expect(canAccess(actor,"direct_purchase")).toBe(false);
      expect(canPlaceCompanyAdminDirectPurchase(actor)).toBe(false);
    }
    expect(usesCompanyAdministratorDirectPurchase({
      ...companyAdmin,effectivePermissions: [],
    })).toBe(true);
  });

  it("accepts only Cart identity, reviewed version, and stable command identity", () => {
    const accepted = directPurchaseCommandSchema.safeParse({
      cartId: "cart-identity",
      expectedCartVersion: 3,
      commandId: "76000000-0000-4000-8000-000000000004",
    });
    expect(accepted.success).toBe(true);
    for (const forbidden of ["companyId","branchId","total","customerPrice","budget","wallet","paymentStatus","approvalState","latitude","longitude"]) {
      expect(directPurchaseCommandSchema.safeParse({
        cartId: "cart-identity",
        expectedCartVersion: 3,
        commandId: "76000000-0000-4000-8000-000000000004",
        [forbidden]: "forged-browser-value",
      }).success).toBe(false);
    }
  });

  it("calculates demo percentage amounts without floating-point money arithmetic", () => {
    expect(companyAdminDirectPurchaseInternals.percentageOfMoney(
      "100.00" as never,6,
    )).toBe("6.00");
    expect(companyAdminDirectPurchaseInternals.percentageOfMoney(
      "0.05" as never,10,
    )).toBe("0.01");
  });

  it("ships role-aware checkout, recovery, and order terminology in every locale", () => {
    for (const locale of ["en","ar","ms"] as const) {
      const cart = cartMessages(locale);
      const order = requestDetailMessages(locale);
      for (const value of [
        cart.placeOrder,cart.submitRequest,cart.branchBudgetAvailable,
        cart.walletAvailable,cart.orderPlaced,cart.priceChanged,
        cart.insufficientWallet,cart.outcomeUnknown,cart.retrySafely,
        order.directOrder,order.orderPaid,order.companyOrderItemsBody,
      ]) expect(value).toBeTruthy();
    }
  });

  it("keeps one confirmation and sends every committed result to a durable receipt", () => {
    const cart = readFileSync(
      new URL("../src/components/CartReview.tsx",import.meta.url),"utf8",
    );
    const action = readFileSync(
      new URL("../src/app/(portal)/cart/actions.ts",import.meta.url),"utf8",
    );
    const detail = readFileSync(
      new URL("../src/app/(portal)/requests/[id]/page.tsx",import.meta.url),"utf8",
    );
    const requestAction = readFileSync(
      new URL("../src/app/(portal)/requests/actions.ts",import.meta.url),"utf8",
    );
    const newRequestPage = readFileSync(
      new URL("../src/app/(portal)/requests/new/page.tsx",import.meta.url),"utf8",
    );
    const productsPage = readFileSync(
      new URL("../src/app/(portal)/products/page.tsx",import.meta.url),"utf8",
    );
    expect(cart).toContain("sessionStorage.setItem(storageKey");
    expect(cart).toContain("`${PENDING_PURCHASE_KEY}:${purchaseRecoveryScope}`");
    expect(cart).toContain("cartId: workspace.cartId");
    expect(cart).toContain("expectedCartVersion: workspace.cartVersion");
    expect(cart).toContain("cartId: confirmation.cartId");
    expect(cart).toContain("expectedCartVersion: confirmation.expectedCartVersion");
    expect(cart).toContain("reconcileCompanyAdminDirectPurchaseAction");
    expect(cart).toContain("<dialog");
    expect(cart).toContain("dialog.showModal()");
    expect(cart).toContain("placeOrderRef.current?.focus()");
    expect(cart).toContain('window.location.replace(`/requests/${encodeURIComponent(result.requestId)}?placed=1`)');
    expect(cart).not.toContain("setPurchaseResult");
    expect(cart).not.toContain("if (purchaseResult");
    expect(cart).not.toMatch(/name=["'](?:total|companyId|wallet|budget|price)/);
    expect(action).toContain('requirePermission("direct_purchase")');
    expect(action).toContain('revalidatePath("/approvals")');
    expect(detail).toContain('id="invoice"');
    expect(detail).toContain('request.purchaseMode === "COMPANY_ADMIN_DIRECT"');
    expect(detail).toContain('feedback.placed === "1"');
    expect(detail).toContain('request.paymentStatus === "Paid"');
    expect(detail).toContain('getAuthorizedRequest(actor, id)');
    expect(detail).toContain('className="cart-purchase-success"');
    expect(detail).toContain("finalInvoice.amount");
    expect(detail).toContain("request.orderCode");
    expect(detail).toContain("branchBudget?.branchCode ?? request.branchName");
    expect(detail).toContain("/requests/${encodeURIComponent(request.id)}#invoice");
    expect(detail).toContain('href="/deliveries"');
    expect(requestAction).toContain("usesCompanyAdministratorDirectPurchase(user)");
    expect(newRequestPage).toContain("usesCompanyAdministratorDirectPurchase(actor)");
    expect(productsPage).toContain("usesCompanyAdministratorDirectPurchase(actor)");
  });
});
