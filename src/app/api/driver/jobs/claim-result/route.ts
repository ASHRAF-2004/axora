import { getSession } from "@/lib/auth";
import { getDeliveryClaimResult } from "@/lib/driver-operations";
import { canAccess } from "@/lib/permissions";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const actor = await getSession();
  if (!actor) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!canAccess(actor, "view_delivery_portal")) {
    return Response.json({ error: "Claim result unavailable" }, { status: 403 });
  }
  try {
    const url = new URL(request.url);
    const input = z.object({
      jobId: z.uuid(),
      commandId: z.uuid(),
    }).parse({
      jobId: url.searchParams.get("jobId"),
      commandId: url.searchParams.get("commandId"),
    });
    const result = await getDeliveryClaimResult(
      actor,
      input.jobId,
      input.commandId,
    );
    if (!result) {
      return Response.json({ error: "Claim result unavailable" }, { status: 404 });
    }
    return Response.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    return Response.json({ error: "Claim result unavailable" }, { status: 404 });
  }
}
