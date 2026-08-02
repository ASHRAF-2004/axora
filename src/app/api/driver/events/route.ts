import { getSession } from "@/lib/auth";
import { DRIVER_EVENT_TYPES, isUuid } from "@/lib/driver-offline-queue";
import { canAccess } from "@/lib/permissions";
import { recordDriverEvent } from "@/lib/role-portals-repository";
import {
  validateDeliveryEventDetails,
  type DeliveryClientEventType,
} from "@/lib/delivery-portal";

async function readLimitedJson(request: Request, maximumBytes: number) {
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new Error("Body too large");
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export async function POST(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "update_assigned_deliveries")) {
    return Response.json({ error: "You do not have permission to update deliveries." }, { status: 403 });
  }
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) {
    return Response.json({ error: "Delivery event is too large." }, { status: 413 });
  }
  let body: Record<string, unknown>;
  try {
    const value = await readLimitedJson(request, 16_384);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    body = value as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Delivery event is invalid." }, { status: 400 });
  }
  if (!isUuid(body.deliveryJobId) || !isUuid(body.assignmentId)
    || !isUuid(body.deviceId) || !isUuid(body.clientEventId)
    || !Number.isSafeInteger(body.deviceSequence) || Number(body.deviceSequence) < 0
    || !DRIVER_EVENT_TYPES.includes(body.eventType as DeliveryClientEventType)
    || typeof body.clientRecordedAt !== "string"
    || Number.isNaN(new Date(body.clientRecordedAt).getTime())) {
    return Response.json({ error: "Delivery event is invalid." }, { status: 400 });
  }
  let details;
  try {
    details = validateDeliveryEventDetails(body.eventType as DeliveryClientEventType, {
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(body.issueCode !== undefined ? { issueCode: body.issueCode } : {}),
      ...(body.receiverName !== undefined ? { receiverName: body.receiverName } : {}),
      ...(body.lineOutcomes !== undefined ? { lineOutcomes: body.lineOutcomes } : {}),
    });
  } catch {
    return Response.json({ error: "Delivery event details are invalid." }, { status: 400 });
  }
  try {
    const result = await recordDriverEvent(actor, {
      deliveryJobId: body.deliveryJobId,
      assignmentId: body.assignmentId,
      deviceId: body.deviceId,
      clientEventId: body.clientEventId,
      deviceSequence: Number(body.deviceSequence),
      eventType: body.eventType as DeliveryClientEventType,
      clientRecordedAt: body.clientRecordedAt,
      ...details,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const conflict = error instanceof Error && error.message.includes("already used");
    return Response.json({ error: conflict ? error.message : "Delivery event could not be recorded for this assignment." }, { status: conflict ? 409 : 400 });
  }
}
