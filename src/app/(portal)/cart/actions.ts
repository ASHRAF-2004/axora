"use server";

import { requirePermission } from "@/lib/auth";
import {
  directPurchaseCommandSchema,
  placeCompanyAdminDirectPurchase,
  reconcileCompanyAdminDirectPurchase,
  type CompanyAdminDirectPurchaseReconciliation,
  type CompanyAdminDirectPurchaseResult,
} from "@/lib/company-admin-direct-purchase";
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
  | { ok: true; result: CompanyAdminDirectPurchaseResult }
  | { ok: false; code: "UNAVAILABLE" };

export async function runCompanyAdminDirectPurchaseAction(
  rawCommand: unknown,
): Promise<DirectPurchaseActionResult> {
  const actor = await requirePermission("direct_purchase");
  const parsed = directPurchaseCommandSchema.safeParse(rawCommand);
  if (!parsed.success) return { ok: false, code: "UNAVAILABLE" };
  try {
    const result = await placeCompanyAdminDirectPurchase(actor, parsed.data);
    revalidatePath("/products");
    revalidatePath("/cart");
    revalidatePath("/requests");
    revalidatePath("/approvals");
    revalidatePath("/wallet");
    revalidatePath("/deliveries");
    if ("requestId" in result) revalidatePath(`/requests/${result.requestId}`);
    return { ok: true, result };
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
