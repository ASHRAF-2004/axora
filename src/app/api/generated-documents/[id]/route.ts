import { getSession } from "@/lib/auth";
import { loadGeneratedDocumentFile } from "@/lib/generated-documents";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getSession();
  if (!actor) return new Response("Not found", { status: 404 });
  const file = await loadGeneratedDocumentFile(actor, (await params).id);
  if (!file) return new Response("Not found", { status: 404 });
  const fallback = file.fileName.normalize("NFKD").replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(file.fileName).replace(/['()*]/g, (value) => (
    `%${value.charCodeAt(0).toString(16).toUpperCase()}`
  ));
  return new Response(new Uint8Array(file.bytes), { headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${fallback || "axora-document.pdf"}"; filename*=UTF-8''${encoded}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    ETag: `"${file.checksumSha256}"`,
  } });
}
