import { getSession } from "@/lib/auth";
import { getCustomerCatalogProductsByPublicRefs } from "@/lib/catalog";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const actor = await getSession();

  if (!actor) {
    return Response.json(
      { error: "Authentication required" },
      { status: 401 },
    );
  }

  if (!canAccess(actor, "view_catalog")) {
    return Response.json(
      { error: "Catalog access denied" },
      { status: 403 },
    );
  }

  try {
    const body = await request.json();
    const productRefs = body?.productRefs;

    if (
      !Array.isArray(productRefs) ||
      productRefs.length > 100 ||
      productRefs.some((ref) => typeof ref !== "string")
    ) {
      return Response.json(
        { error: "Provide up to 100 valid product references." },
        { status: 400 },
      );
    }

    const products = await getCustomerCatalogProductsByPublicRefs(
      productRefs,
      actor,
    );

    return Response.json(
      { products },
      {
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Cookie",
        },
      },
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to refresh the request cart.",
      },
      { status: 400 },
    );
  }
}
