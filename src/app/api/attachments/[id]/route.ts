import { getSession } from "@/lib/auth";
import { loadAttachmentFile } from "@/lib/operations";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!await getSession()) return Response.json({ error: "Authentication required" }, { status: 401 });
  const file = await loadAttachmentFile((await params).id);
  if (!file) return Response.json({ error: "Attachment not found" }, { status: 404 });
  const downloadName = file.fileName.replace(/["\r\n]/g, "_");
  return new Response(file.bytes, { headers: {
    "Content-Type": file.contentType,
    "Content-Disposition": `attachment; filename="${downloadName}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  } });
}
