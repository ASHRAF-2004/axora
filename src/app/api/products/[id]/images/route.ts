import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { listProductImages } from "@/lib/product-images";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if ((!actor.isOwner && actor.accountKind !== "PLATFORM") || !canAccess(actor, "view_catalog")) {
    return Response.json({ error: "Catalog access denied" }, { status: 403 });
  }

  const images = await listProductImages((await params).id, actor);
  return Response.json(
    { images },
    { headers: { "Cache-Control": "private, max-age=60, must-revalidate", Vary: "Cookie" } },
  );
}
