import { getSession } from "@/lib/auth";
import {
  createReceivingDeliveryOtp,
  getReceivingDeliveryWorkspace,
} from "@/lib/delivery-execution";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_receiving")) {
    return Response.json({ error: "Delivery confirmation unavailable" }, { status: 403 });
  }
  try {
    return Response.json(await getReceivingDeliveryWorkspace(actor), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Delivery confirmation unavailable" }, { status: 404 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_receiving")) {
    return Response.json({ error: "Delivery confirmation unavailable" }, { status: 403 });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 8_192) return Response.json({ error: "Delivery confirmation unavailable" }, { status: 413 });
  try {
    return Response.json(await createReceivingDeliveryOtp(actor, await request.json()), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Delivery confirmation unavailable" }, { status: 409 });
  }
}
