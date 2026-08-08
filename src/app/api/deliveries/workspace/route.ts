import { getSession } from "@/lib/auth";
import { getDeliverySupervisorWorkspace } from "@/lib/delivery-execution";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "manage_deliveries")) {
    return Response.json({ error: "Delivery workspace unavailable" }, { status: 403 });
  }
  try {
    return Response.json(await getDeliverySupervisorWorkspace(actor), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Delivery workspace unavailable" }, { status: 404 });
  }
}
