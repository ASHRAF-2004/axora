import { getSession } from "@/lib/auth";
import { loadDeliveryEvidenceFile } from "@/lib/delivery-execution";
import { verifyDeliveryEvidenceAccess } from "@/lib/delivery-proof";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getSession();
  if (!actor) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const url = new URL(request.url);
  if (!verifyDeliveryEvidenceAccess({
    actorId: actor.id,
    evidenceId: id,
    expires: url.searchParams.get("expires"),
    signature: url.searchParams.get("signature"),
  })) return new Response("Not found", { status: 404 });
  const file = await loadDeliveryEvidenceFile(actor, id);
  if (!file) return new Response("Not found", { status: 404 });
  const fallback = file.fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(file.fileName).replace(/['()*]/g, (value) => (
    `%${value.charCodeAt(0).toString(16).toUpperCase()}`
  ));
  const disposition = url.searchParams.get("preview") === "1"
    && file.contentType.startsWith("image/") ? "inline" : "attachment";
  return new Response(new Uint8Array(file.bytes), { headers: {
    "Content-Type": file.contentType,
    "Content-Disposition": `${disposition}; filename="${fallback || "delivery-evidence"}"; filename*=UTF-8''${encoded}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    ETag: `"${file.sha256}"`,
  } });
}
