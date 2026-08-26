import { getSession } from "@/lib/auth";
import { getDriverDeliveryCommandResult } from "@/lib/delivery-execution";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_delivery_portal")) {
    return Response.json({ error: "Delivery command unavailable" }, { status: 403 });
  }
  const parameters = new URL(request.url).searchParams;
  try {
    const value = await getDriverDeliveryCommandResult(actor, {
      jobId: parameters.get("jobId"),
      kind: parameters.get("kind"),
      commandId: parameters.get("commandId"),
      relatedCommandId: parameters.get("relatedCommandId") || undefined,
    });
    if (!value) {
      return Response.json({ error: "Delivery command unavailable" }, {
        status: 404,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    return Response.json(value, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Delivery command unavailable" }, { status: 404 });
  }
}
