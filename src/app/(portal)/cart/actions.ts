"use server";

import { requirePermission } from "@/lib/auth";
import {
  directPurchaseCommandSchema,
  getCompanyAdminDirectPurchaseWorkspace,
  placeCompanyAdminDirectPurchase,
  reconcileCompanyAdminDirectPurchase,
  type CompanyAdminDirectPurchaseReconciliation,
  type CompanyAdminDirectPurchaseResult,
  type CompanyAdminDirectPurchaseWorkspace,
} from "@/lib/company-admin-direct-purchase";
import { matchesCartRecoveryWorkspace } from "@/lib/cart-workspace-recovery";
import {
  procurementCartCommandSchema,
  procurementCartErrorCode,
  type ProcurementCartCommand,
} from "@/lib/procurement-cart-command";
import { commandProcurementCart, type ProcurementCartSnapshot } from "@/lib/procurement-cart";
import { revalidatePath } from "next/cache";
import { z } from "zod";

export type CartCommandActionResult =
  | { ok: true; cart: ProcurementCartSnapshot }
  | { ok: false; code: ReturnType<typeof procurementCartErrorCode>; cart?: ProcurementCartSnapshot };

export async function runCartCommandAction(
  rawCommand: ProcurementCartCommand,
): Promise<CartCommandActionResult> {
  const actor = await requirePermission("create_requests");
  const parsed = procurementCartCommandSchema.safeParse(rawCommand);
  if (!parsed.success) return { ok: false, code: procurementCartErrorCode(parsed.error) };
  let cart: ProcurementCartSnapshot;
  try {
    cart = await commandProcurementCart(actor, parsed.data);
  } catch (error) {
    const code = procurementCartErrorCode(error);
    if (code === "STALE_CART") {
      const cart = await commandProcurementCart(actor, {
        branchId: parsed.data.branchId,
        operation: "READ",
      }).catch(() => undefined);
      return { ok: false, code, ...(cart ? { cart } : {}) };
    }
    return { ok: false, code };
  }
  if (parsed.data.operation !== "READ") {
    revalidatePath("/products");
    revalidatePath("/cart");
    revalidatePath("/requests/new");
  }
  return { ok: true, cart };
}

export type DirectPurchaseActionResult =
  | { ok: true; result: CompanyAdminDirectPurchaseResult; staleWorkspace?: CompanyAdminDirectPurchaseWorkspace }
  | { ok: false; code: "UNAVAILABLE" };

export async function runCompanyAdminDirectPurchaseAction(
  rawCommand: unknown,
): Promise<DirectPurchaseActionResult> {
  const actor = await requirePermission("direct_purchase");
  const parsed = directPurchaseCommandSchema.safeParse(rawCommand);
  if (!parsed.success) return { ok: false, code: "UNAVAILABLE" };
  try {
    const result = await placeCompanyAdminDirectPurchase(actor, parsed.data);
    let staleWorkspace: CompanyAdminDirectPurchaseWorkspace | undefined;
    if (result.status === "STALE_CART" && !result.created && result.cart?.status === "ACTIVE"
      && result.commandId === parsed.data.commandId && result.cartId === parsed.data.cartId
      && result.expectedCartVersion === parsed.data.expectedCartVersion
      && result.currentCartVersion === result.cart.version && result.cart.id === result.cartId
      && result.cart.companyId === actor.companyId && !result.cart.departmentId) {
      try {
        const workspace = await getCompanyAdminDirectPurchaseWorkspace(actor, {
          id: result.cart.id, version: result.cart.version,
        });
        if (matchesCartRecoveryWorkspace(workspace, result.cart)) staleWorkspace = workspace;
      } catch {
        // A denied, raced, or unavailable read must not erase a known refusal
        // or turn it into an unknown purchase outcome. Never replay the command.
      }
    }
    revalidatePath("/products");
    revalidatePath("/cart");
    revalidatePath("/requests");
    revalidatePath("/approvals");
    revalidatePath("/wallet");
    revalidatePath("/deliveries");
    if ("requestId" in result) revalidatePath(`/requests/${result.requestId}`);
    return { ok: true, result, ...(staleWorkspace ? { staleWorkspace } : {}) };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}

export type DirectPurchaseReconciliationActionResult =
  | { ok: true; result: CompanyAdminDirectPurchaseReconciliation }
  | { ok: false; code: "UNAVAILABLE" };

export async function reconcileCompanyAdminDirectPurchaseAction(
  rawInput: unknown,
): Promise<DirectPurchaseReconciliationActionResult> {
  const actor = await requirePermission("direct_purchase");
  const parsed = z.object({ commandId: z.string().uuid() }).strict().safeParse(rawInput);
  if (!parsed.success) return { ok: false, code: "UNAVAILABLE" };
  try {
    return {
      ok: true,
      result: await reconcileCompanyAdminDirectPurchase(actor, parsed.data.commandId),
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
