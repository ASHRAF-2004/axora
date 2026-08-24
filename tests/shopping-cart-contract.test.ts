import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { AuthenticatedSessionUser } from "@/lib/auth";
import { cartMessages } from "@/lib/cart-i18n";
import { procurementCartCommandSchema, procurementCartErrorCode } from "@/lib/procurement-cart-command";
import { resolveShoppingBranch, type ShoppingBranchContext } from "@/lib/shopping-context";
import { shoppingContextMessages } from "@/lib/shopping-context-i18n";

const companyActor: AuthenticatedSessionUser = {
  id: "10000000-0000-4000-8000-000000000001", email: "admin@example.test",
  name: "Company administrator", role: "COMPANY_ADMIN", accountKind: "COMPANY",
  scopeType: "COMPANY", companyId: "20000000-0000-4000-8000-000000000001",
  roleAssignmentId: "30000000-0000-4000-8000-000000000001",
  isOwner: false, authVersion: 1,
};
const branches: ShoppingBranchContext[] = [
  { id: "40000000-0000-4000-8000-000000000001", code: "TEST1", name: "Test one", city: "Cyberjaya", address: "Test address", canManageLocation: true, ready: true },
  { id: "40000000-0000-4000-8000-000000000002", code: "TEST2", name: "Test two", city: "Kuala Lumpur", address: "Other address", canManageLocation: true, ready: true },
];

describe("shopping and cart product contract", () => {
  it("never auto-selects a Company Administrator branch and rejects forged context", () => {
    expect(resolveShoppingBranch(companyActor, branches, undefined)).toBeUndefined();
    expect(resolveShoppingBranch(companyActor, branches, "random-branch")).toBeUndefined();
    expect(resolveShoppingBranch(companyActor, branches, branches[1].id)).toEqual(branches[1]);
  });

  it("forces a branch-scoped actor to the server-authorized branch", () => {
    const branchActor = { ...companyActor, role: "BRANCH_ADMIN" as const, scopeType: "BRANCH" as const, branchId: branches[0].id };
    expect(resolveShoppingBranch(branchActor, branches, branches[1].id)).toEqual(branches[0]);
  });

  it.each([0, -1, -10, 1.5, "abc", "", " ", "1e3", 999_999_999, Number.MAX_SAFE_INTEGER])
  ("rejects invalid authoritative quantity %j", (quantity) => {
    expect(procurementCartCommandSchema.safeParse({
      branchId: branches[0].id, operation: "SET", productRef: "product",
      quantity, expectedVersion: 1, commandId: "50000000-0000-4000-8000-000000000001",
    }).success).toBe(false);
  });

  it("accepts only versioned, idempotent integer mutations", () => {
    expect(procurementCartCommandSchema.safeParse({
      branchId: branches[0].id, operation: "SET", productRef: "product",
      quantity: 1, expectedVersion: 1, commandId: "50000000-0000-4000-8000-000000000001",
    }).success).toBe(true);
    expect(procurementCartCommandSchema.safeParse({
      branchId: branches[0].id, operation: "SET", productRef: "product", quantity: 2,
    }).success).toBe(false);
    expect(procurementCartErrorCode(Object.assign(new Error("constraint"), { code: "23514" })))
      .toBe("INVALID_QUANTITY");
  });

  it("ships the branch and quantity contract in English, Arabic and Malay", () => {
    for (const locale of ["en", "ar", "ms"] as const) {
      expect(shoppingContextMessages(locale).chooserTitle).toBeTruthy();
      expect(shoppingContextMessages(locale).separateCarts).toBeTruthy();
      expect(cartMessages(locale).invalidQuantity).toBeTruthy();
    }
  });

  it("keeps Cart branch read-only, request type absent, and server default deterministic", () => {
    const cart = readFileSync(new URL("../src/components/CartReview.tsx", import.meta.url), "utf8");
    const requestForm = readFileSync(new URL("../src/components/RequestForm.tsx", import.meta.url), "utf8");
    const action = readFileSync(new URL("../src/app/(portal)/requests/actions.ts", import.meta.url), "utf8");
    expect(cart).not.toMatch(/<select[^>]*branch|name=["']branchId["']/);
    expect(requestForm).not.toContain("name=\"requestType\"");
    expect(action).toContain('requestType: "Standard"');
  });

  it("invalidates every cart-derived route and resynchronizes restored or cross-tab pages", () => {
    const action = readFileSync(new URL("../src/app/(portal)/cart/actions.ts", import.meta.url), "utf8");
    const cart = readFileSync(new URL("../src/components/CartReview.tsx", import.meta.url), "utf8");
    const shop = readFileSync(new URL("../src/components/ShopCategoryHub.tsx", import.meta.url), "utf8");
    for (const path of ["/products", "/cart", "/requests/new"]) {
      expect(action).toContain(`revalidatePath("${path}")`);
    }
    for (const source of [cart, shop]) {
      expect(source).toContain('window.addEventListener("pageshow"');
      expect(source).toContain('window.addEventListener("popstate"');
      expect(source).toContain('window.addEventListener("online"');
      expect(source).toContain("subscribeCartChanged");
      expect(source).toContain("applyAuthoritative");
    }
  });
});
