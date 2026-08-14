import { getSession } from "@/lib/auth";
import { getDriverDetailWorkspace } from "@/lib/driver-operations";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ driverId: string }> }) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "manage_deliveries")) return Response.json({ error: "Driver unavailable" }, { status: 403 });
  const driver = await getDriverDetailWorkspace(actor, (await params).driverId);
  return driver
    ? Response.json(driver, { headers: { "Cache-Control": "private, no-store" } })
    : Response.json({ error: "Driver unavailable" }, { status: 404 });
}
