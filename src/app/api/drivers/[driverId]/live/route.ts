import { getSession } from "@/lib/auth";
import { getDriverDetailWorkspace } from "@/lib/driver-operations";
import { canAccess } from "@/lib/permissions";
import { authorizedLiveSnapshotStream } from "@/lib/live-update-reader";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ driverId: string }> }) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "manage_deliveries")) return Response.json({ error: "Delivery Agent unavailable" }, { status: 403 });
  const { driverId } = await params;
  return authorizedLiveSnapshotStream(request, actor, "driver", async (current) => {
    const driver = await getDriverDetailWorkspace(current, driverId);
    if (!driver) throw new Error("Delivery Agent unavailable");
    return driver;
  }, 8_000);
}
