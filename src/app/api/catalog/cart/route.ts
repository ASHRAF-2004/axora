import { getSession } from "@/lib/auth";
import { getCatalogProductsByIds } from "@/lib/catalog";
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
    const productIds = body?.productIds;

    if (
      !Array.isArray(productIds) ||
      productIds.length > 100 ||
      productIds.some((id) => typeof id !== "string")
    ) {
      return Response.json(
        { error: "Provide up to 100 valid product IDs." },
        { status: 400 },
      );
    }

    const products = await getCatalogProductsByIds(
      productIds,
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
