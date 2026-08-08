import { getSession } from "@/lib/auth";
import {
  assignCanonicalDeliveryJob,
  manageCanonicalDeliveryJob,
} from "@/lib/delivery-execution";
import { canAccess } from "@/lib/permissions";

export async function POST(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "manage_deliveries")) {
    return Response.json({ error: "Delivery command unavailable" }, { status: 403 });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 32_768) return Response.json({ error: "Delivery command unavailable" }, { status: 413 });
  try {
    const body = await request.json() as { action?: string };
    const value = body.action === "ASSIGN"
      ? await assignCanonicalDeliveryJob(actor, body)
      : await manageCanonicalDeliveryJob(actor, body);
    return Response.json(value, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Delivery command unavailable" }, { status: 409 });
  }
}
