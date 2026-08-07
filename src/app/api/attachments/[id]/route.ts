import { getSession } from "@/lib/auth";
import { loadAuthorizedAttachmentFile } from "@/lib/document-isolation";
import { canAccess } from "@/lib/permissions";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await getSession();
  if (!actor) {
    return Response.json({ error: "Authentication required" }, { status: 401 });
  }
  if (!canAccess(actor, "view_documents")) {
    return Response.json(
      { error: "You do not have permission to view documents." },
      { status: 403 },
    );
  }

  const file = await loadAuthorizedAttachmentFile(actor, (await params).id);
  if (!file) {
    return Response.json({ error: "Attachment not found" }, { status: 404 });
  }

  const downloadName = file.fileName.replace(/["\r\n]/g, "_");
  return new Response(new Uint8Array(file.bytes), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
