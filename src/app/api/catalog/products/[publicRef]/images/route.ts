import { getSession } from "@/lib/auth";
import { getCatalogProductsByPublicRefs } from "@/lib/catalog";
import { canAccess } from "@/lib/permissions";
import { listProductImages } from "@/lib/product-images";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ publicRef: string }> }) {
  const actor = await getSession();
  if (!actor) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!canAccess(actor, "view_catalog")) return Response.json({ error: "Catalog access denied" }, { status: 403 });
  const product = (await getCatalogProductsByPublicRefs([(await params).publicRef], actor))[0];
  if (!product) return Response.json({ error: "Product image not found" }, { status: 404 });
  return Response.json({ images: await listProductImages(product.id, actor) }, {
    headers: { "Cache-Control": "private, max-age=60, must-revalidate", Vary: "Cookie" },
  });
}
