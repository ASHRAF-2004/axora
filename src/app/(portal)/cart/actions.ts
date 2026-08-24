"use server";

import { requirePermission } from "@/lib/auth";
import {
  procurementCartCommandSchema,
  procurementCartErrorCode,
  type ProcurementCartCommand,
} from "@/lib/procurement-cart-command";
import { commandProcurementCart, type ProcurementCartSnapshot } from "@/lib/procurement-cart";
import { revalidatePath } from "next/cache";

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
