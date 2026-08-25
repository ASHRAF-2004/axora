import { getSession } from "@/lib/auth";
import { setDriverAvailability } from "@/lib/driver-operations";
import { canAccess } from "@/lib/permissions";
import { z } from "zod";

export async function PATCH(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_delivery_portal")) return Response.json({ error: "Availability unavailable" }, { status: 403 });
  try {
    const { availability } = z.object({ availability: z.enum(["AVAILABLE","UNAVAILABLE"]) }).parse(await request.json());
    return Response.json({ availability: await setDriverAvailability(actor, availability) }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Availability unavailable" }, { status: 409 });
  }
}
