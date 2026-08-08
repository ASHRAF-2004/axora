import { getSession } from "@/lib/auth";
import { submitDeliveryShoppingActual } from "@/lib/delivery-execution";
import { canAccess } from "@/lib/permissions";

export async function POST(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "update_assigned_deliveries")) {
    return Response.json({ error: "Shopping record unavailable" }, { status: 403 });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 6 * 1024 * 1024) {
    return Response.json({ error: "Shopping record unavailable" }, { status: 413 });
  }
  try {
    const value = await submitDeliveryShoppingActual(actor, await request.formData());
    return Response.json(value, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Shopping record unavailable" }, { status: 409 });
  }
}
