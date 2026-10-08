import type { CompanyAdminDirectPurchaseWorkspace } from "./company-admin-direct-purchase";
import type { ProcurementCartSnapshot } from "./procurement-cart";

export type CartWorkspaceRecovery = {
  recoveryScope: string;
  workspace: CompanyAdminDirectPurchaseWorkspace;
};

function sameCartIdentity(left: ProcurementCartSnapshot, right: ProcurementCartSnapshot) {
  return left.id === right.id && left.companyId === right.companyId
    && left.branchId === right.branchId && (left.departmentId ?? null) === (right.departmentId ?? null);
}

function workspaceIdentifiesCart(
  workspace: CompanyAdminDirectPurchaseWorkspace,
  cart: ProcurementCartSnapshot,
) {
  return cart.status === "ACTIVE" && !cart.departmentId
    && workspace.cartId === cart.id && workspace.cartVersion === cart.version
    && workspace.companyId === cart.companyId && workspace.branchId === cart.branchId
    && workspace.cart.status === "ACTIVE" && !workspace.cart.departmentId
    && workspace.cart.version === cart.version && sameCartIdentity(workspace.cart, cart);
}

/** A recovered workspace must describe the exact customer-visible Cart, not
 * merely a matching version: offer prices can change without a Cart command.
 * Compare the server projections directly; never reconstruct financial values.
 */
export function matchesCartRecoveryWorkspace(
  workspace: CompanyAdminDirectPurchaseWorkspace | undefined,
  cart: ProcurementCartSnapshot,
): workspace is CompanyAdminDirectPurchaseWorkspace {
  if (!workspace || !workspaceIdentifiesCart(workspace, cart)
    || workspace.cart.items.length !== cart.items.length) return false;
  const items = new Map(cart.items.map((item) => [item.publicRef, item]));
  const matched = new Set<string>();
  if (items.size !== cart.items.length) return false;
  return workspace.cart.items.every((item) => {
    const current = items.get(item.publicRef);
    if (!current || matched.has(item.publicRef)) return false;
    matched.add(item.publicRef);
    return item.quantity === current.quantity && item.specification === current.specification
      && item.currency === current.currency
      && item.currency === workspace.currency
      && item.unitPrice === current.unitPrice && item.displayedUnitPrice === current.displayedUnitPrice
      && item.priceRuleVersion === current.priceRuleVersion
      && item.displayedPriceRuleVersion === current.displayedPriceRuleVersion
      && item.lineTotal === current.lineTotal && item.available === current.available
      && item.categoryAllowed === current.categoryAllowed && item.repriced === current.repriced;
  });
}

export function selectCartWorkspace({
  cart, initialCart, branchId, serverWorkspace, recovery, recoveryScope,
}: {
  cart: ProcurementCartSnapshot;
  initialCart: ProcurementCartSnapshot;
  branchId: string;
  serverWorkspace?: CompanyAdminDirectPurchaseWorkspace;
  recovery?: CartWorkspaceRecovery;
  recoveryScope: string;
}): CompanyAdminDirectPurchaseWorkspace | undefined {
  if (!sameCartIdentity(cart, initialCart) || cart.branchId !== branchId
    || initialCart.status !== "ACTIVE" || initialCart.version > cart.version) return undefined;
  // Matching route authority always wins. Preserve the established PRICE_CHANGED
  // path: an RSC offer projection may change at the same Cart version while the
  // local quantity draft is intentionally preserved.
  if (serverWorkspace && workspaceIdentifiesCart(serverWorkspace, cart)) return serverWorkspace;
  if (initialCart.version >= cart.version || !recovery || recovery.recoveryScope !== recoveryScope) return undefined;
  // A different scope or equally/newer non-matching route authority invalidates
  // an older recovery. The fallback only bridges still-stale route props.
  if (serverWorkspace && (serverWorkspace.cartId !== cart.id
    || serverWorkspace.companyId !== cart.companyId || serverWorkspace.branchId !== cart.branchId
    || !sameCartIdentity(serverWorkspace.cart, cart) || serverWorkspace.cart.status !== "ACTIVE"
    || serverWorkspace.cart.version !== serverWorkspace.cartVersion
    || serverWorkspace.cartVersion >= cart.version)) return undefined;
  return matchesCartRecoveryWorkspace(recovery.workspace, cart) ? recovery.workspace : undefined;
}
