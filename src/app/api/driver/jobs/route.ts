import { randomUUID } from "node:crypto";
import { getSession } from "@/lib/auth";
import { claimAvailableDeliveryJob, getAvailableDeliveryJobs } from "@/lib/driver-operations";
import { canAccess } from "@/lib/permissions";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_delivery_portal")) return Response.json({ error: "Delivery jobs unavailable" }, { status: 403 });
  try {
    return Response.json(await getAvailableDeliveryJobs(actor), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return Response.json({ error: "Delivery jobs unavailable" }, { status: 404 });
  }
}

export async function POST(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_delivery_portal")) return Response.json({ error: "Delivery job unavailable" }, { status: 403 });
  if (Number(request.headers.get("content-length") ?? 0) > 2048) return Response.json({ error: "Delivery job unavailable" }, { status: 413 });
  try {
    const body = z.object({ jobId: z.uuid(), commandId: z.uuid().default(randomUUID()) }).parse(await request.json());
    return Response.json(await claimAvailableDeliveryJob(actor, body.jobId, body.commandId), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message.includes("already claimed")
      ? "This job was already claimed." : "Delivery job unavailable" }, { status: 409 });
  }
}
