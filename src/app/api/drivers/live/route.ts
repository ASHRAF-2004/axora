import { getSession } from "@/lib/auth";
import { getDriverManagementWorkspace } from "@/lib/driver-operations";
import { canAccess } from "@/lib/permissions";
import { authorizedLiveSnapshotStream } from "@/lib/live-update-reader";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "manage_deliveries")) return Response.json({ error: "Delivery Agent workspace unavailable" }, { status: 403 });
  return authorizedLiveSnapshotStream(request, actor, "drivers", getDriverManagementWorkspace, 10_000);
}
