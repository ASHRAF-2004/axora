import { getSession } from "@/lib/auth";
import {
  getDriverDeliveryTracking,
  recordDeliveryTrackingPoint,
  reportOrEndDriverTracking,
} from "@/lib/delivery-tracking";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_delivery_portal")) {
    return Response.json({ error: "Delivery tracking unavailable" }, { status: 403 });
  }
  try {
    return Response.json(await getDriverDeliveryTracking(actor), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Delivery tracking unavailable" }, { status: 404 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "update_assigned_deliveries")) {
    return Response.json({ error: "Delivery tracking unavailable" }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) {
    return Response.json({ error: "Delivery tracking unavailable" }, { status: 413 });
  }
  try {
    const body = await request.json() as { action?: string };
    const value = body.action === "POINT"
      ? await recordDeliveryTrackingPoint(actor, body)
      : await reportOrEndDriverTracking(actor, body);
    return Response.json(value, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Delivery tracking unavailable" }, { status: 409 });
  }
}
