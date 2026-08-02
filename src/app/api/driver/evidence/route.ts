import { getSession } from "@/lib/auth";
import { isUuid } from "@/lib/driver-offline-queue";
import { canAccess } from "@/lib/permissions";
import { uploadDriverEvidence } from "@/lib/role-portals-repository";

export async function POST(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "update_assigned_deliveries")) {
    return Response.json({ error: "You do not have permission to upload delivery evidence." }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 6 * 1024 * 1024) {
    return Response.json({ error: "Delivery evidence is too large." }, { status: 413 });
  }
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Delivery evidence is invalid." }, { status: 400 });
  }
  const deliveryJobId = String(formData.get("deliveryJobId") ?? "");
  const eventId = String(formData.get("eventId") ?? "");
  const clientEvidenceId = String(formData.get("clientEvidenceId") ?? "");
  const capturedAt = String(formData.get("capturedAt") ?? "");
  const file = formData.get("file");
  if (!isUuid(deliveryJobId) || !isUuid(eventId) || !isUuid(clientEvidenceId)
    || Number.isNaN(new Date(capturedAt).getTime())
    || !(file instanceof File) || file.size === 0) {
    return Response.json({ error: "Delivery evidence is invalid." }, { status: 400 });
  }
  try {
    const result = await uploadDriverEvidence(actor, { deliveryJobId, eventId, clientEvidenceId, capturedAt, file });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const conflict = error instanceof Error && error.message.includes("already used");
    return Response.json({ error: conflict ? error.message : "Evidence could not be uploaded for this delivery event." }, { status: conflict ? 409 : 400 });
  }
}
