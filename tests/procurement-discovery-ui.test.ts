import { readFile } from "node:fs/promises";
import { describe,expect,it } from "vitest";

const source=(path:string) => readFile(new URL(`../${path}`,import.meta.url),"utf8");

describe("procurement discovery UI and API",() => {
  it("uses one validated database-scoped filter contract for list, options and export",async () => {
    const [page,reader,options,exportRoute]=await Promise.all([
      source("src/app/(portal)/requests/page.tsx"),source("src/lib/request-reader.ts"),
      source("src/app/api/requests/filter-options/route.ts"),source("src/app/api/export/requests/route.ts"),
    ]);
    expect(page).toContain("searchAuthorizedRequests(actor");
    expect(reader).toContain("axora_request_access_rows($1,$2,$3)");
    expect(reader).toContain("count(DISTINCT r.id)");
    expect(reader).toContain("AT TIME ZONE");
    expect(options).toContain("normalizeRequestOptionValues");
    expect(exportRoute).toContain("normalizeRequestFilters");
    expect(exportRoute).toContain("listAuthorizedFilteredRequests(user,filters)");
    expect(page).not.toContain("scopedRequests.filter");
  });

  it("keeps the complete catalogue bookmarkable, paginated and customer-safe",async () => {
    const [shop,catalog,route]=await Promise.all([
      source("src/components/ShopCategoryHub.tsx"),source("src/lib/catalog.ts"),
      source("src/app/api/catalog/route.ts"),
    ]);
    expect(shop).toContain('href="/products?view=all"');
    expect(shop).toContain("useSearchParams");
    expect(shop).toContain("shop-pagination");
    expect(shop).toContain('tabIndex={0}');
    expect(catalog).toContain("v_customer_catalog_products");
    expect(catalog).toContain("0::float8 AS \"defaultBuyPrice\"");
    expect(route).toContain('"Cache-Control": "private, no-store"');
  });
});
