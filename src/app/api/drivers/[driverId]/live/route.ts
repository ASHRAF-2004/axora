import { getSession } from "@/lib/auth";
import { getDriverDetailWorkspace } from "@/lib/driver-operations";
import { canAccess } from "@/lib/permissions";
import { snapshotEventStream } from "@/lib/server-event-stream";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ driverId: string }> }) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "manage_deliveries")) return Response.json({ error: "Delivery Agent unavailable" }, { status: 403 });
  const { driverId } = await params;
  return snapshotEventStream(request, async () => {
    const driver = await getDriverDetailWorkspace(actor, driverId);
    if (!driver) throw new Error("Delivery Agent unavailable");
    return driver;
  }, 8_000);
}
