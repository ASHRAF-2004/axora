import { createHash } from "node:crypto";
import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { loadProductImage } from "@/lib/product-images";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_catalog")) {
    return Response.json({ error: "Catalog access denied" }, { status: 403 });
  }

  const { id, imageId } = await params;
  const image = await loadProductImage(id, actor, imageId);
  if (!image) return Response.json({ error: "Product image not found" }, { status: 404 });

  const etag = `"${createHash("sha256").update(image.content).digest("hex")}"`;
  const headers = new Headers({
    "Cache-Control": "private, max-age=3600, must-revalidate",
    "Content-Disposition": "inline; filename=\"product-image.webp\"",
    "Content-Length": String(image.content.length),
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "Content-Type": image.contentType,
    "Cross-Origin-Resource-Policy": "same-origin",
    ETag: etag,
    Vary: "Cookie",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(new Uint8Array(image.content), { status: 200, headers });
}
