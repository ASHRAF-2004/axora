import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  isDemoMode: () => true,
  query: vi.fn(),
  withAuditTransaction: vi.fn(),
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  getCompanyAdminDirectPurchaseWorkspace,
  placeCompanyAdminDirectPurchase,
  reconcileCompanyAdminDirectPurchase,
} from "@/lib/company-admin-direct-purchase";
import { companyWalletInternals } from "@/lib/company-wallet";
import { getDemoStore } from "@/lib/demo-data";
import { commandProcurementCart } from "@/lib/procurement-cart";

const actor = {
  id: "77000000-0000-4000-8000-000000000001",
  email: "demo-company-admin@fixture.invalid",
  name: "Demo Company Administrator",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: "co-youruni",
  roleAssignmentId: "77000000-0000-4000-8000-000000000002",
  isOwner: false,
  authVersion: 1,
} satisfies AuthenticatedSessionUser;

function productReference(name: string) {
  return `demo-${name.normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,64)}`;
}

describe("Company Administrator direct purchase in demo mode", () => {
  beforeEach(() => {
    const globals = globalThis as typeof globalThis & {
      __axoraDemoStore?: unknown;
      __axoraDemoProcurementCarts?: unknown;
      __axoraDemoFinanceState?: unknown;
      __axoraDemoDirectPurchases?: unknown;
    };
    globals.__axoraDemoStore = undefined;
    globals.__axoraDemoProcurementCarts = undefined;
    globals.__axoraDemoFinanceState = undefined;
    globals.__axoraDemoDirectPurchases = undefined;
  });

  async function cartWithOneProduct() {
    const branchId = "br-youruni-main";
    const product = getDemoStore().products.find((item) => item.status === "Active")!;
    const read = await commandProcurementCart(actor,{
      branchId,operation: "READ",
    });
    return commandProcurementCart(actor,{
      branchId,operation: "ADD",productRef: productReference(product.name),
      quantity: 1,expectedVersion: read.version,
    });
  }

  it("places, consumes, and reconciles one paid order without a request approval", async () => {
    const cart = await cartWithOneProduct();
    const workspace = await getCompanyAdminDirectPurchaseWorkspace(actor,cart);
    const branch = getDemoStore().branches.find((item) => item.id === cart.branchId)!;
    const budgetBefore = branch.remainingAmount!;
    const walletBefore = companyWalletInternals.demoBalance(actor.companyId!);
    const commandId = "77000000-0000-4000-8000-000000000010";
    const placed = await placeCompanyAdminDirectPurchase(actor,{
      cartId: cart.id,expectedCartVersion: cart.version,commandId,
    });
    expect(placed).toMatchObject({
      status: "SUCCESS",amount: workspace.orderTotal,currency: "MYR",created: true,
    });
    if (placed.status !== "SUCCESS") throw new Error("Expected a successful direct purchase.");
    const request = getDemoStore().requests.find((item) => item.id === placed.requestId);
    expect(request).toMatchObject({
      purchaseMode: "COMPANY_ADMIN_DIRECT",approvalStatus: "Approved",
      paymentStatus: "Paid",invoiceStatus: "Issued",createdById: actor.id,
    });
    expect(branch.remainingAmount).toBe(budgetBefore - Number(workspace.orderTotal));
    expect(companyWalletInternals.demoBalance(actor.companyId!)).toBe(
      (Number(walletBefore) - Number(workspace.orderTotal)).toFixed(2),
    );
    expect(await placeCompanyAdminDirectPurchase(actor,{
      cartId: cart.id,expectedCartVersion: cart.version,commandId,
    })).toMatchObject({
      status: "ALREADY_PROCESSED",requestId: placed.requestId,created: false,
    });
    expect(await reconcileCompanyAdminDirectPurchase(actor,commandId)).toMatchObject({
      status: "ALREADY_PROCESSED",requestId: placed.requestId,created: false,
    });
    expect(await placeCompanyAdminDirectPurchase(actor,{
      cartId: cart.id,expectedCartVersion: cart.version,
      commandId: "77000000-0000-4000-8000-000000000011",
    })).toMatchObject({
      status: "CART_ALREADY_PURCHASED",requestId: placed.requestId,
      orderReference: placed.orderReference,created: false,
    });
    const consumed = await commandProcurementCart(actor,{
      branchId: cart.branchId,operation: "READ",
    });
    expect(consumed).toMatchObject({ status: "ACTIVE",version: 1,items: [] });
    expect(getDemoStore().requests.filter((item) => item.id === placed.requestId))
      .toHaveLength(1);
  });

  it("reconciles a changed customer price without moving money", async () => {
    const cart = await cartWithOneProduct();
    const product = getDemoStore().products.find((item) => (
      productReference(item.name) === cart.items[0]!.publicRef
    ))!;
    const walletBefore = companyWalletInternals.demoBalance(actor.companyId!);
    product.defaultSellPrice += 1;
    product.priceRuleVersion = (product.priceRuleVersion ?? 1) + 1;
    const result = await placeCompanyAdminDirectPurchase(actor,{
      cartId: cart.id,expectedCartVersion: cart.version,
      commandId: "77000000-0000-4000-8000-000000000012",
    });
    expect(result).toMatchObject({
      status: "PRICE_CHANGED",currentCartVersion: cart.version + 1,created: false,
    });
    expect(companyWalletInternals.demoBalance(actor.companyId!)).toBe(walletBefore);
    expect(getDemoStore().requests.some((item) => (
      item.purchaseMode === "COMPANY_ADMIN_DIRECT" && item.createdById === actor.id
    ))).toBe(false);
  });
});
