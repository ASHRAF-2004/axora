import { getSession } from "@/lib/auth";
import { isUuid } from "@/lib/driver-offline-queue";
import { canAccess } from "@/lib/permissions";
import { loadSupplierDocument } from "@/lib/role-portals-repository";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_supplier_portal")) {
    return Response.json({ error: "You do not have permission to view supplier documents." }, { status: 403 });
  }
  const { id } = await params;
  if (!isUuid(id)) return Response.json({ error: "Document not found" }, { status: 404 });
  const file = await loadSupplierDocument(actor, id);
  if (!file) return Response.json({ error: "Document not found" }, { status: 404 });
  const downloadName = file.fileName.normalize("NFKD").replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encodedName = encodeURIComponent(file.fileName).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return new Response(new Uint8Array(file.bytes), { headers: {
    "Content-Type": file.contentType,
    "Content-Disposition": `attachment; filename="${downloadName || "document"}"; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
