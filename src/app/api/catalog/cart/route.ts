import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { commandProcurementCart } from "@/lib/procurement-cart";
import { z } from "zod";

export const dynamic = "force-dynamic";

const commandSchema = z.object({
  branchId: z.string().trim().min(1).max(160),
  operation: z.enum(["READ", "ADD", "SET", "REMOVE", "ACKNOWLEDGE_PRICES"]),
  productRef: z.string().trim().max(160).optional(),
  quantity: z.coerce.number().int().min(1).max(1_000_000).optional(),
  specification: z.string().trim().max(1_000).optional(),
  expectedVersion: z.coerce.number().int().positive().optional(),
  commandId: z.string().uuid().optional(),
}).strict();

function businessError(error: unknown) {
  const code = error && typeof error === "object" && "code" in error
    ? String(error.code) : "";
  if (code === "P8202") return { code: "REPRICED", error: "A cart item price changed and requires review." };
  if (code === "P8203") return { code: "STALE_CART", error: "The cart changed. Refresh and try again." };
  if (code === "P8204") return { code: "PRODUCT_NOT_ALLOWED", error: "This product is unavailable for the selected purchasing scope." };
  if (code === "P8205") return { code: "EMPTY_CART", error: "The cart is empty." };
  return { code: "CART_UNAVAILABLE", error: "The cart is unavailable." };
}

export async function POST(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  if (!canAccess(actor, "view_catalog") || !canAccess(actor, "create_requests")) {
    return Response.json({ code: "CART_FORBIDDEN" }, { status: 403 });
  }
  try {
    const input = commandSchema.parse(await request.json());
    const cart = await commandProcurementCart(actor, input);
    return Response.json({ cart }, {
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  } catch (error) {
    return Response.json(businessError(error), { status: 400 });
  }
}
