import { z } from "zod";

import { loadBranchDeliveryLocationWorkspace } from "./branch-delivery-location";
import type { AuthenticatedSessionUser } from "./auth";
import { loadOrganizationDirectory } from "./organization-access";
import { getCatalogPurchasingScope } from "./procurement-cart";

export const SHOPPING_BRANCH_COOKIE = "axora_shopping_branch";

const branchIdentifier = z.string().trim().min(1).max(160);

export interface ShoppingBranchContext {
  id: string;
  code: string;
  name: string;
  city: string;
  address: string;
  canManageLocation: boolean;
  ready: boolean;
}

export async function loadShoppingBranchContexts(
  actor: AuthenticatedSessionUser,
): Promise<ShoppingBranchContext[]> {
  if (actor.accountKind !== "COMPANY" || !actor.companyId) return [];
  const directory = await loadOrganizationDirectory(actor);
  const candidates = directory.branches.filter((branch) => (
    branch.companyId === actor.companyId
    && branch.status === "Active"
    && (!actor.branchId || branch.id === actor.branchId)
  ));

  const contexts = await Promise.all(candidates.map(async (branch) => {
    const [scope, locationWorkspace] = await Promise.all([
      getCatalogPurchasingScope(actor, branch.id).catch(() => null),
      loadBranchDeliveryLocationWorkspace(actor, branch.id).catch(() => null),
    ]);
    if (!scope || scope.companyId !== actor.companyId || scope.branchId !== branch.id) {
      return null;
    }
    const location = locationWorkspace?.location ?? null;
    return {
      id: branch.id,
      code: branch.branchCode || branch.code,
      name: branch.name,
      city: branch.city,
      address: location?.addressLabel ?? branch.deliveryAddress,
      canManageLocation: Boolean(locationWorkspace?.canManage),
      ready: Boolean(location),
    } satisfies ShoppingBranchContext;
  }));

  return contexts.filter((branch): branch is ShoppingBranchContext => Boolean(branch));
}

export function resolveShoppingBranch(
  actor: AuthenticatedSessionUser,
  contexts: readonly ShoppingBranchContext[],
  requestedBranchId: string | null | undefined,
) {
  const candidate = actor.branchId ?? requestedBranchId;
  if (!candidate || !branchIdentifier.safeParse(candidate).success) return undefined;
  return contexts.find((branch) => branch.id === candidate);
}

export const shoppingContextInternals = { branchIdentifier };
