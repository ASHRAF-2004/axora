import { Buffer } from "node:buffer";

import { getSession } from "@/lib/auth";
import { recordPaidDeliveryAcquisition } from "@/lib/delivery-execution";
import { canAccess } from "@/lib/permissions";

const MAX_ACQUISITION_BODY_BYTES = 6 * 1024 * 1024;

class AcquisitionBodyTooLarge extends Error {}

async function boundedFormData(request: Request) {
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;") || !request.body) {
    throw new Error("Delivery acquisition unavailable");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0
      || parsedLength > MAX_ACQUISITION_BODY_BYTES) {
      throw new AcquisitionBodyTooLarge();
    }
  }
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > MAX_ACQUISITION_BODY_BYTES) {
      await reader.cancel();
      throw new AcquisitionBodyTooLarge();
    }
    chunks.push(Buffer.from(chunk.value));
  }
  return new Response(Buffer.concat(chunks, total), {
    headers: { "Content-Type": contentType },
  }).formData();
}

export async function POST(request: Request) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "update_assigned_deliveries")) {
    return Response.json({ error: "Delivery acquisition unavailable" }, { status: 403 });
  }
  try {
    const value = await recordPaidDeliveryAcquisition(actor, await boundedFormData(request));
    return Response.json(value, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AcquisitionBodyTooLarge) {
      return Response.json({ error: "Delivery acquisition unavailable" }, { status: 413 });
    }
    return Response.json({ error: "Delivery acquisition unavailable" }, { status: 409 });
  }
}
