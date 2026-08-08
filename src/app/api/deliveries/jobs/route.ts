import { getSession } from "@/lib/auth";
import { createCanonicalDeliveryJob } from "@/lib/delivery-execution";
import { canAccess } from "@/lib/permissions";

export async function POST(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "manage_deliveries")) {
    return Response.json({ error: "Delivery job unavailable" }, { status: 403 });
  }
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 24_576) return Response.json({ error: "Delivery job unavailable" }, { status: 413 });
  try {
    return Response.json(await createCanonicalDeliveryJob(actor, await request.json()), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Delivery job unavailable" }, { status: 409 });
  }
}
