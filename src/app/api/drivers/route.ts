import { getSession } from "@/lib/auth";
import { getDriverManagementWorkspace } from "@/lib/driver-operations";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "manage_deliveries")) return Response.json({ error: "Driver workspace unavailable" }, { status: 403 });
  try {
    return Response.json(await getDriverManagementWorkspace(actor), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Driver workspace unavailable" }, { status: 404 });
  }
}
