import { searchCatalogProducts, type CatalogSort } from "@/lib/catalog";
import { getSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";

export const dynamic = "force-dynamic";

function listParameter(params: URLSearchParams, name: string) {
  return params
    .getAll(name)
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
}

function optionalNumber(value: string | null) {
  if (value === null || value.trim() === "") return undefined;

  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

export async function GET(request: Request) {
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

  const params = new URL(request.url).searchParams;

  try {
    const result = await searchCatalogProducts(
      {
        query: params.get("q") ?? "",
        categories: listParameter(params, "category"),
        subcategories: listParameter(params, "subcategory"),
        brands: listParameter(params, "brand"),
        units: listParameter(params, "unit"),
        minPrice: optionalNumber(params.get("minPrice")),
        maxPrice: optionalNumber(params.get("maxPrice")),
        maxDeliveryDays: optionalNumber(
          params.get("maxDeliveryDays"),
        ),
        sort: (params.get("sort") ?? "relevance") as CatalogSort,
        page: optionalNumber(params.get("page")),
        limit: optionalNumber(params.get("limit")),
      },
      actor,
    );

    return Response.json(result, {
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to load the product catalog.",
      },
      { status: 400 },
    );
  }
}
