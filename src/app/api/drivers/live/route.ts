import { getSession } from "@/lib/auth";
import { getDriverManagementWorkspace } from "@/lib/driver-operations";
import { canAccess } from "@/lib/permissions";
import { snapshotEventStream } from "@/lib/server-event-stream";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "manage_deliveries")) return Response.json({ error: "Driver workspace unavailable" }, { status: 403 });
  return snapshotEventStream(request, () => getDriverManagementWorkspace(actor));
}
