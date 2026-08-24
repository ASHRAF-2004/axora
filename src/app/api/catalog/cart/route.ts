import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import {
  procurementCartCommandSchema,
  procurementCartErrorCode,
  type ProcurementCartCommandCode,
} from "@/lib/procurement-cart-command";
import { commandProcurementCart } from "@/lib/procurement-cart";
import { revalidatePath } from "next/cache";

export const dynamic = "force-dynamic";

function businessError(error: unknown) {
  const code = procurementCartErrorCode(error);
  const messages: Record<ProcurementCartCommandCode, string> = {
    AUTH_REQUIRED: "Authentication is required.",
    CART_FORBIDDEN: "Cart access is unavailable.",
    INVALID_COMMAND: "The cart command is invalid.",
    INVALID_QUANTITY: "Quantity must be a whole number between 1 and 1,000,000.",
    REPRICED: "A cart item price changed and requires review.",
    STALE_CART: "The cart changed. The latest cart must be reviewed.",
    PRODUCT_NOT_ALLOWED: "This product is unavailable for the selected purchasing scope.",
    EMPTY_CART: "The cart is empty.",
    CART_UNAVAILABLE: "The cart is unavailable.",
  };
  return { code, error: messages[code] };
}

export async function POST(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ code: "AUTH_REQUIRED" }, { status: 401 });
  if (!canAccess(actor, "view_catalog") || !canAccess(actor, "create_requests")) {
    return Response.json({ code: "CART_FORBIDDEN" }, { status: 403 });
  }
  let input;
  let cart;
  try {
    input = procurementCartCommandSchema.parse(await request.json());
    cart = await commandProcurementCart(actor, input);
  } catch (error) {
    const body = businessError(error);
    const status = body.code === "STALE_CART" ? 409
      : body.code === "INVALID_COMMAND" || body.code === "INVALID_QUANTITY" ? 422
        : body.code === "PRODUCT_NOT_ALLOWED" ? 403 : 400;
    return Response.json(body, {
      status,
      headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
    });
  }
  let revalidationPending = false;
  if (input.operation !== "READ") {
    try {
      revalidatePath("/products");
      revalidatePath("/cart");
      revalidatePath("/requests/new");
    } catch {
      revalidationPending = true;
    }
  }
  return Response.json({ cart, ...(revalidationPending ? { revalidationPending } : {}) }, {
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
