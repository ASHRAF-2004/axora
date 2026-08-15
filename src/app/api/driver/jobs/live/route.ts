import { getSession } from "@/lib/auth";
import { getAvailableDeliveryJobs } from "@/lib/driver-operations";
import { canAccess } from "@/lib/permissions";
import { snapshotEventStream } from "@/lib/server-event-stream";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_delivery_portal")) return Response.json({ error: "Delivery jobs unavailable" }, { status: 403 });
  return snapshotEventStream(request, () => getAvailableDeliveryJobs(actor));
}
