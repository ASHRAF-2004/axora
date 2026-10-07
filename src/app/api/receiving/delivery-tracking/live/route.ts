import { getSession } from "@/lib/auth";
import { getCompanyDeliveryTracking } from "@/lib/delivery-tracking";
import { canAccess } from "@/lib/permissions";
import { authorizedLiveSnapshotStream } from "@/lib/live-update-reader";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_receiving") && !canAccess(actor, "view_deliveries")) {
    return Response.json({ error: "Delivery tracking unavailable" }, { status: 403 });
  }
  return authorizedLiveSnapshotStream(request, actor, "receiving", getCompanyDeliveryTracking, 10_000);
}
