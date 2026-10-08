import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyAdminDirectPurchaseWorkspace } from "@/lib/company-admin-direct-purchase";
import type { ProcurementCartSnapshot } from "@/lib/procurement-cart";
import { parseMoneyDecimal } from "@/lib/money-decimal";
import { matchesCartRecoveryWorkspace, selectCartWorkspace } from "@/lib/cart-workspace-recovery";
import { cartMessages } from "@/lib/cart-i18n";

const hooks = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as Array<{ current: unknown }>, stateIndex: 0, refIndex: 0,
  purchase: vi.fn(), reconcile: vi.fn(), cartCommand: vi.fn(), refresh: vi.fn(),
}));
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = typeof initial === "function" ? initial() : initial;
    return [hooks.states[index], (next: unknown) => {
      hooks.states[index] = typeof next === "function" ? next(hooks.states[index]) : next;
    }];
  },
  useRef: (initial: unknown) => {
    const index = hooks.refIndex++;
    hooks.refs[index] ??= { current: initial };
    return hooks.refs[index];
  },
  useCallback: <T,>(callback: T) => callback,
  useEffect: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: hooks.refresh }) }));
vi.mock("next/link", () => ({ default: (props: Record<string, unknown>) => createElement("a", props) }));
vi.mock("@/components/ProductImage", () => ({ ProductImage: () => null }));
vi.mock("@/lib/cart-client-events", () => ({ publishCartChanged: vi.fn(), subscribeCartChanged: vi.fn() }));
vi.mock("@/app/(portal)/cart/actions", () => ({
  runCompanyAdminDirectPurchaseAction: hooks.purchase,
  reconcileCompanyAdminDirectPurchaseAction: hooks.reconcile,
  runCartCommandAction: hooks.cartCommand,
}));
import { CartReview } from "@/components/CartReview";

function cart(version = 3): ProcurementCartSnapshot {
  return {
    id: "cart-fixture", companyId: "company-fixture", branchId: "branch-fixture", version,
    status: "ACTIVE", updatedAt: "2026-10-08T00:00:00.000Z", items: [{
      publicRef: "public-sticky-notes", name: "Sticky notes", category: "Stationery", subcategory: "Notes",
      unit: "pack", unitPrice: "4.40", displayedUnitPrice: "4.40", priceRuleVersion: 1,
      displayedPriceRuleVersion: 1, currency: "MYR", deliverySlaDays: 2, hasImage: false,
      quantity: version === 2 ? 1 : 2, specification: "", available: true, categoryAllowed: true,
      repriced: false, lineTotal: version === 2 ? "4.40" : "8.80",
    }],
  };
}
function workspace(snapshot = cart()): CompanyAdminDirectPurchaseWorkspace {
  return {
    capturedAt: new Date("2026-10-08T00:00:00.000Z"), companyId: snapshot.companyId,
    branchId: snapshot.branchId, branchCode: "TEST", branchName: "Fixture branch",
    cartId: snapshot.id, cartVersion: snapshot.version, cart: structuredClone(snapshot),
    subtotal: parseMoneyDecimal(snapshot.items[0]?.lineTotal ?? "0.00"), deliveryFee: parseMoneyDecimal("0.00"),
    taxAmount: parseMoneyDecimal("0.00"), orderTotal: parseMoneyDecimal(snapshot.items[0]?.lineTotal ?? "0.00"),
    currency: "MYR", budgetAvailable: parseMoneyDecimal("100.00"), walletAvailable: parseMoneyDecimal("200.00"),
    budgetReady: true, locationReady: true, priceChanged: false,
  };
}
function recovery(pair = workspace()) {
  return { recoveryScope: "public-fixture-actor", workspace: pair };
}
function selection(overrides: Partial<Parameters<typeof selectCartWorkspace>[0]> = {}) {
  return selectCartWorkspace({ cart: cart(), initialCart: cart(2), branchId: "branch-fixture",
    serverWorkspace: workspace(cart(2)), recovery: recovery(), recoveryScope: "public-fixture-actor", ...overrides });
}

type HostElement = ReactElement<Record<string, unknown>>;
function hosts(node: ReactNode): HostElement[] {
  if (Array.isArray(node)) return node.flatMap(hosts);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [...(typeof node.type === "string" ? [node] : []), ...hosts(node.props.children as ReactNode)];
}
function render(props: Partial<Parameters<typeof CartReview>[0]> = {}) {
  hooks.stateIndex = 0; hooks.refIndex = 0;
  return CartReview({ initialCart: cart(2), directPurchase: workspace(cart(2)), checkoutMode: "DIRECT",
    branch: { id: "branch-fixture", code: "TEST", name: "Fixture branch", city: "", address: "",
      canManageLocation: true, ready: true, budgetAvailable: null }, locale: "en",
    purchaseRecoveryScope: "public-fixture-actor", ...props });
}
function placeButton(tree: ReactNode) {
  const button = hosts(tree).find((element) => element.type === "button"
    && element.props.children === cartMessages("en").placeOrder);
  expect(button).toBeDefined();
  return button!;
}

describe("Cart workspace recovery selection", () => {
  it("uses the exact recovered pair while the route still holds version 2", () => {
    expect(selection()?.cartVersion).toBe(3);
    expect(selection({ recovery: undefined })).toBeUndefined();
  });
  it("treats raw PostgreSQL null and parsed undefined as the same absent department, never as a real department", () => {
    // The Cart command returns SQL105 JSON directly; the purchase workspace
    // schema normalizes its null optional department to undefined.
    const rawCurrent = { ...cart(), departmentId: null } as unknown as ProcurementCartSnapshot;
    const rawInitial = { ...cart(2), departmentId: null } as unknown as ProcurementCartSnapshot;
    expect(matchesCartRecoveryWorkspace(workspace(), rawCurrent)).toBe(true);
    expect(selection({ cart: rawCurrent, initialCart: rawInitial })?.cartVersion).toBe(3);
    const fresh = workspace();
    expect(selection({ cart: rawCurrent, initialCart: rawCurrent, serverWorkspace: fresh })).toBe(fresh);
    expect(selection({ cart: { ...rawCurrent, departmentId: "real-department" } })).toBeUndefined();
  });
  it("prefers matching fresh route authority, including the established PRICE_CHANGED path", () => {
    const fresh = workspace(); fresh.priceChanged = true;
    Object.assign(fresh.cart.items[0], { unitPrice: "5.00", lineTotal: "10.00", priceRuleVersion: 2, repriced: true });
    fresh.subtotal = parseMoneyDecimal("10.00"); fresh.orderTotal = parseMoneyDecimal("10.00");
    expect(selection({ serverWorkspace: fresh })).toBe(fresh);
    expect(matchesCartRecoveryWorkspace(fresh, cart())).toBe(false);
  });
  it.each(["id", "companyId", "branchId"] as const)("rejects changed %s context", (key) => {
    expect(selection({ initialCart: { ...cart(2), [key]: "different" } })).toBeUndefined();
    expect(selection({ cart: { ...cart(), [key]: "different" } })).toBeUndefined();
  });
  it("does not recover over newer, different, or self-inconsistent route props", () => {
    expect(selection({ initialCart: cart(4) })).toBeUndefined();
    expect(selection({ serverWorkspace: workspace(cart(4)) })).toBeUndefined();
    expect(selection({ serverWorkspace: { ...workspace(cart(2)), cartId: "other-cart" } })).toBeUndefined();
    expect(selection({ serverWorkspace: { ...workspace(cart(2)), cart: { ...cart(2), companyId: "other" } } })).toBeUndefined();
    expect(selection({ serverWorkspace: { ...workspace(), cart: cart(2) } })).toBeUndefined();
    expect(selection({ cart: cart(4) })).toBeUndefined();
    expect(selection({ branchId: "other-branch" })).toBeUndefined();
    expect(selection({ recoveryScope: "different-actor-or-assignment" })).toBeUndefined();
    expect(selection({ initialCart: cart(), serverWorkspace: undefined })).toBeUndefined();
    expect(selection({ initialCart: cart(), serverWorkspace: workspace(cart(2)) })).toBeUndefined();
  });
  it.each(["cartId", "companyId", "branchId", "cartVersion"] as const)("rejects recovered %s mismatches", (key) => {
    expect(selection({ recovery: recovery({ ...workspace(), [key]: key === "cartVersion" ? 4 : "other" }) })).toBeUndefined();
  });
  it.each([
    ["publicRef", "other-product"], ["quantity", 7], ["specification", "different"], ["currency", "USD"],
    ["unitPrice", "5.00"], ["displayedUnitPrice", "5.00"], ["priceRuleVersion", 2],
    ["displayedPriceRuleVersion", 2], ["lineTotal", "10.00"], ["available", false],
    ["categoryAllowed", false], ["repriced", true],
  ])("rejects a different recovered customer projection (%s)", (key, value) => {
    const pair = workspace(); Object.assign(pair.cart.items[0], { [String(key)]: value });
    expect(selection({ recovery: recovery(pair) })).toBeUndefined();
  });
  it("rejects inactive/department Carts, inconsistent self snapshots, currencies, and duplicate lines", () => {
    for (const snapshot of [cart(2), { ...cart(), status: "SUBMITTED" as const }, { ...cart(), departmentId: "department" }]) {
      expect(selection({ recovery: recovery({ ...workspace(), cart: snapshot }) })).toBeUndefined();
    }
    expect(selection({ recovery: recovery({ ...workspace(), currency: "USD" }) })).toBeUndefined();
    const duplicate = cart(); duplicate.items.push({ ...duplicate.items[0] });
    expect(matchesCartRecoveryWorkspace(workspace(duplicate), duplicate)).toBe(false);
  });
});

describe("CartReview known-stale held-props recovery", () => {
  beforeEach(() => {
    hooks.states = []; hooks.refs = []; hooks.stateIndex = 0; hooks.refIndex = 0;
    vi.clearAllMocks();
    const storage = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
    vi.stubGlobal("crypto", { randomUUID: () => "bb000000-0000-4000-8000-000000000001" });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders matched financial authority and unlocks review after one STALE refusal even when RSC props stay at v2", async () => {
    const result = { status: "STALE_CART", commandId: "bb000000-0000-4000-8000-000000000001",
      cartId: "cart-fixture", created: false, expectedCartVersion: 2, currentCartVersion: 3, cart: cart() };
    hooks.purchase.mockResolvedValue({ ok: true, result, staleWorkspace: workspace() });
    hooks.states[9] = true; // The unchanged pending-command recovery has completed.
    let tree = render();
    expect(placeButton(tree).props.disabled).toBe(false);
    (placeButton(tree).props.onClick as () => void)();
    tree = render();
    const dialog = hosts(tree).find((element) => element.type === "dialog")!;
    (placeButton(dialog).props.onClick as () => void)();
    // Only the existing mocked purchase response resolves; no browser/read/retry
    // effect is invoked by this deterministic hook/render fixture.
    await Promise.resolve(); await Promise.resolve();
    tree = render();
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('class="cart-financial-authority"');
    expect(html).toContain(cartMessages("en").stalePurchase);
    expect(html).toContain('value="2"');
    expect(placeButton(tree).props.disabled).toBe(false);
    expect(hooks.purchase).toHaveBeenCalledExactlyOnceWith({ cartId: "cart-fixture", expectedCartVersion: 2,
      commandId: "bb000000-0000-4000-8000-000000000001" });
    expect(hooks.reconcile).not.toHaveBeenCalled(); expect(hooks.cartCommand).not.toHaveBeenCalled();
    expect(hooks.refresh).toHaveBeenCalledOnce();
    expect(hooks.states[0]).toEqual(cart());
  });

  it("retains the original locked state when the optional workspace is absent or mismatched", () => {
    hooks.states[0] = cart(); hooks.states[1] = { "public-sticky-notes": "2" }; hooks.states[9] = true;
    for (const pair of [undefined, workspace(cart(4)), { ...workspace(), companyId: "other" }]) {
      hooks.states[12] = pair ? recovery(pair) : undefined;
      const tree = render();
      expect(placeButton(tree).props.disabled).toBe(true);
      expect(renderToStaticMarkup(tree)).not.toContain('class="cart-financial-authority"');
    }
  });
  it.each(["draft", "error", "busy", "unknown", "purchase", "recovery"])("does not bypass the existing %s lock or overwrite keyboard drafts", (lock) => {
    hooks.states[0] = cart(); hooks.states[1] = { "public-sticky-notes": "2" };
    hooks.states[9] = true; hooks.states[12] = recovery();
    if (lock === "draft") hooks.states[1] = { "public-sticky-notes": "7" };
    if (lock === "error") hooks.states[2] = { "public-sticky-notes": "Invalid" };
    if (lock === "busy") hooks.states[3] = "public-sticky-notes";
    if (lock === "unknown") hooks.states[8] = true;
    if (lock === "purchase") hooks.states[7] = true;
    if (lock === "recovery") hooks.states[9] = false;
    const tree = render();
    const button = hosts(tree).find((element) => element.type === "button" && element.props.className === "button button-primary")!;
    expect(button.props.disabled).toBe(true);
    if (lock === "draft") expect(renderToStaticMarkup(tree)).toContain('value="7"');
    expect(hooks.purchase).not.toHaveBeenCalled();
  });
  it("invalidates retained recovery when the actor/assignment scope or current route refusal changes", () => {
    hooks.states[0] = cart(); hooks.states[1] = { "public-sticky-notes": "2" };
    hooks.states[9] = true; hooks.states[12] = recovery();
    const changedActor = render({ purchaseRecoveryScope: "different-actor-or-assignment" });
    expect(placeButton(changedActor).props.disabled).toBe(true);
    expect(renderToStaticMarkup(changedActor)).not.toContain('class="cart-financial-authority"');
    const deniedFreshRoute = render({ initialCart: cart(), directPurchase: undefined });
    expect(placeButton(deniedFreshRoute).props.disabled).toBe(true);
    expect(renderToStaticMarkup(deniedFreshRoute)).not.toContain('class="cart-financial-authority"');
    const deniedCheckout = renderToStaticMarkup(render({ checkoutMode: "DIRECT_DENIED", directPurchase: undefined }));
    expect(deniedCheckout).not.toContain('class="cart-financial-authority"');
    expect(deniedCheckout).toContain(cartMessages("en").directDenied);
    expect(deniedCheckout).not.toContain(cartMessages("en").placeOrder);
  });
  it("prefers fresh RSC balances and preserves a same-version uncommitted keyboard draft", () => {
    hooks.states[0] = cart(); hooks.states[1] = { "public-sticky-notes": "7" };
    hooks.states[9] = true; hooks.states[12] = recovery();
    const fresh = workspace(); fresh.walletAvailable = parseMoneyDecimal("321.00");
    const tree = render({ initialCart: cart(), directPurchase: fresh });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('class="cart-financial-authority"'); expect(html).toContain("321.00");
    expect(html).toContain('value="7"'); expect(placeButton(tree).props.disabled).toBe(true);
    expect(hooks.purchase).not.toHaveBeenCalled();
  });
  it("permanently retires recovery after fresh matching RSC props even if older route props return", () => {
    hooks.states[0] = cart(); hooks.states[1] = { "public-sticky-notes": "2" };
    hooks.states[9] = true; hooks.states[12] = recovery();
    expect(placeButton(render()).props.disabled).toBe(false);
    const freshTree = render({ initialCart: cart(), directPurchase: workspace() });
    expect(placeButton(freshTree).props.disabled).toBe(false);
    expect(hooks.states[12]).toBeUndefined();
    const regressedTree = render();
    expect(placeButton(regressedTree).props.disabled).toBe(true);
    expect(renderToStaticMarkup(regressedTree)).not.toContain('class="cart-financial-authority"');
    expect(hooks.states[0]).toEqual(cart()); expect(hooks.states[1]).toEqual({ "public-sticky-notes": "2" });
    expect(hooks.purchase).not.toHaveBeenCalled();
  });
  it("permanently retires recovery after newer route authority or a changed account scope", () => {
    hooks.states[0] = cart(); hooks.states[1] = { "public-sticky-notes": "2" };
    hooks.states[9] = true; hooks.states[12] = recovery();
    expect(placeButton(render({ initialCart: cart(4), directPurchase: workspace(cart(4)) })).props.disabled).toBe(true);
    expect(hooks.states[12]).toBeUndefined();
    expect(placeButton(render()).props.disabled).toBe(true);
    hooks.states[12] = recovery();
    expect(placeButton(render({ purchaseRecoveryScope: "different-account" })).props.disabled).toBe(true);
    expect(hooks.states[12]).toBeUndefined(); expect(placeButton(render()).props.disabled).toBe(true);
    expect(hooks.purchase).not.toHaveBeenCalled();
  });
});
