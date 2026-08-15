import { getSession } from "@/lib/auth";
import { getCompanyDeliveryTracking } from "@/lib/delivery-tracking";
import { canAccess } from "@/lib/permissions";
import { snapshotEventStream } from "@/lib/server-event-stream";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_receiving") && !canAccess(actor, "view_deliveries")) {
    return Response.json({ error: "Delivery tracking unavailable" }, { status: 403 });
  }
  return snapshotEventStream(request, () => getCompanyDeliveryTracking(actor), 10_000);
}
