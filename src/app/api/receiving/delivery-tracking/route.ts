import { getSession } from "@/lib/auth";
import { getCompanyDeliveryTracking } from "@/lib/delivery-tracking";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_receiving") && !canAccess(actor, "view_deliveries")) {
    return Response.json({ error: "Delivery tracking unavailable" }, { status: 403 });
  }
  try {
    return Response.json(await getCompanyDeliveryTracking(actor), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Delivery tracking unavailable" }, { status: 404 });
  }
}
