import { getSession } from "@/lib/auth";
import { verifyDriverDeliveryOtp } from "@/lib/delivery-execution";
import { canAccess } from "@/lib/permissions";

export async function POST(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "update_assigned_deliveries")) {
    return Response.json({ error: "Delivery confirmation unavailable" }, { status: 403 });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 8_192) return Response.json({ error: "Delivery confirmation unavailable" }, { status: 413 });
  try {
    const value = await verifyDriverDeliveryOtp(actor, await request.json());
    return Response.json(value, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Delivery confirmation unavailable" }, { status: 409 });
  }
}
