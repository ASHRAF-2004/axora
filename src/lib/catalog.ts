import { requireSession, type SessionUser } from "./auth";
import { isDemoMode, query } from "./db";
import { getDemoStore } from "./demo-data";
import { canAccess } from "./permissions";
import type { Product } from "./types";

export type CatalogSort =
  | "relevance"
  | "name-asc"
  | "price-asc"
  | "price-desc"
  | "delivery-asc"
  | "moq-asc";

export interface CatalogSearchInput {
  query?: string;
  categories?: string[];
  subcategories?: string[];
  brands?: string[];
  units?: string[];
  minPrice?: number;
  maxPrice?: number;
  maxDeliveryDays?: number;
  sort?: CatalogSort;
  page?: number;
  limit?: number;
}

export interface CatalogFacetOption {
  value: string;
  count: number;
}

export interface CatalogSearchResult {
  products: Product[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  facets: {
    categories: CatalogFacetOption[];
    subcategories: CatalogFacetOption[];
    brands: CatalogFacetOption[];
    units: CatalogFacetOption[];
    minimumPrice: number;
    maximumPrice: number;
  };
}

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 48;

function uniqueValues(values: string[] | undefined) {
  return [...new Set(
    (values ?? [])
      .map((value) => value.trim())
      .filter(Boolean),
  )];
}

function normalizeInput(input: CatalogSearchInput) {
  const page = Math.max(Math.floor(input.page ?? 1), 1);
  const limit = Math.min(
    Math.max(Math.floor(input.limit ?? DEFAULT_LIMIT), 1),
    MAX_LIMIT,
  );

  return {
    query: input.query?.trim().slice(0, 150) ?? "",
    categories: uniqueValues(input.categories),
    subcategories: uniqueValues(input.subcategories),
    brands: uniqueValues(input.brands),
    units: uniqueValues(input.units),
    minPrice:
      Number.isFinite(input.minPrice) && Number(input.minPrice) >= 0
        ? Number(input.minPrice)
        : undefined,
    maxPrice:
      Number.isFinite(input.maxPrice) && Number(input.maxPrice) >= 0
        ? Number(input.maxPrice)
        : undefined,
    maxDeliveryDays:
      Number.isFinite(input.maxDeliveryDays) &&
      Number(input.maxDeliveryDays) >= 0
        ? Math.floor(Number(input.maxDeliveryDays))
        : undefined,
    sort: input.sort ?? "relevance",
    page,
    limit,
  };
}

function searchableProductText(product: Product) {
  return [
    product.code,
    product.name,
    product.category,
    product.subcategory,
    product.brand,
    product.size,
    product.unit,
    product.packaging,
    product.description,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function demoFacets(products: Product[]) {
  function count(values: Array<string | undefined>) {
    const totals = new Map<string, number>();

    for (const value of values) {
      const normalized = value?.trim();
      if (!normalized) continue;
      totals.set(normalized, (totals.get(normalized) ?? 0) + 1);
    }

    return [...totals.entries()]
      .map(([value, total]) => ({ value, count: total }))
      .sort((a, b) => a.value.localeCompare(b.value));
  }

  const prices = products.map((product) => product.defaultSellPrice);

  return {
    categories: count(products.map((product) => product.category)),
    subcategories: count(products.map((product) => product.subcategory)),
    brands: count(products.map((product) => product.brand)),
    units: count(products.map((product) => product.unit)),
    minimumPrice: prices.length ? Math.min(...prices) : 0,
    maximumPrice: prices.length ? Math.max(...prices) : 0,
  };
}

function sortDemoProducts(
  products: Product[],
  sort: CatalogSort,
  searchTerm: string,
) {
  return [...products].sort((left, right) => {
    if (sort === "price-asc") {
      return left.defaultSellPrice - right.defaultSellPrice;
    }

    if (sort === "price-desc") {
      return right.defaultSellPrice - left.defaultSellPrice;
    }

    if (sort === "delivery-asc") {
      return left.deliverySlaDays - right.deliverySlaDays;
    }

    if (sort === "moq-asc") {
      return (
        left.minimumOrderQuantity - right.minimumOrderQuantity
      );
    }

    if (sort === "relevance" && searchTerm) {
      const term = searchTerm.toLowerCase();

      function rank(product: Product) {
        if (product.code.toLowerCase() === term) return 0;
        if (product.name.toLowerCase() === term) return 1;
        if (product.name.toLowerCase().startsWith(term)) return 2;
        if (product.code.toLowerCase().startsWith(term)) return 3;
        return 4;
      }

      const difference = rank(left) - rank(right);
      if (difference) return difference;
    }

    return left.name.localeCompare(right.name);
  });
}

async function searchDemoCatalog(
  actor: SessionUser,
  rawInput: CatalogSearchInput,
): Promise<CatalogSearchResult> {
  const input = normalizeInput(rawInput);

  const accessibleProducts = getDemoStore().products.filter(
    (product) =>
      product.status === "Active" &&
      !product.duplicateWarning &&
      (
        actor.isOwner ||
        !product.companyId ||
        product.companyId === actor.companyId
      ),
  );

  const searchMatches = accessibleProducts.filter((product) =>
    input.query
      ? searchableProductText(product).includes(
          input.query.toLowerCase(),
        )
      : true,
  );

  const facets = demoFacets(searchMatches);

  const filtered = searchMatches.filter((product) => {
    if (
      input.categories.length &&
      !input.categories.includes(product.category)
    ) {
      return false;
    }

    if (
      input.subcategories.length &&
      !input.subcategories.includes(product.subcategory)
    ) {
      return false;
    }

    if (
      input.brands.length &&
      (!product.brand || !input.brands.includes(product.brand))
    ) {
      return false;
    }

    if (
      input.units.length &&
      !input.units.includes(product.unit)
    ) {
      return false;
    }

    if (
      input.minPrice !== undefined &&
      product.defaultSellPrice < input.minPrice
    ) {
      return false;
    }

    if (
      input.maxPrice !== undefined &&
      product.defaultSellPrice > input.maxPrice
    ) {
      return false;
    }

    if (
      input.maxDeliveryDays !== undefined &&
      product.deliverySlaDays > input.maxDeliveryDays
    ) {
      return false;
    }

    return true;
  });

  const sorted = sortDemoProducts(
    filtered,
    input.sort,
    input.query,
  );

  const offset = (input.page - 1) * input.limit;
  const products = sorted
    .slice(offset, offset + input.limit)
    .map((product) => ({
      ...product,
      defaultBuyPrice: actor.isOwner
        ? product.defaultBuyPrice
        : 0,
      preferredSupplierId: actor.isOwner
        ? product.preferredSupplierId
        : undefined,
      preferredSupplierName: actor.isOwner
        ? product.preferredSupplierName
        : undefined,
      duplicateWarning: false,
    }));

  return {
    products,
    total: sorted.length,
    page: input.page,
    limit: input.limit,
    totalPages: Math.max(
      Math.ceil(sorted.length / input.limit),
      1,
    ),
    facets,
  };
}

export async function searchCatalogProducts(
  rawInput: CatalogSearchInput = {},
  providedActor?: SessionUser,
): Promise<CatalogSearchResult> {
  const actor = providedActor ?? await requireSession();

  if (!canAccess(actor, "view_catalog")) {
    throw new Error(
      "Your account cannot view the product catalog.",
    );
  }

  if (isDemoMode()) {
    return searchDemoCatalog(actor, rawInput);
  }

  const input = normalizeInput(rawInput);
  const values: unknown[] = [];
  const conditions = [
    "p.active=true",
    "p.needs_review=false",
  ];

  function parameter(value: unknown) {
    values.push(value);
    return `$${values.length}`;
  }

  if (!actor.isOwner) {
    const companyParameter = parameter(actor.companyId);
    conditions.push(
      `(p.company_id IS NULL OR p.company_id=${companyParameter})`,
    );
  }

  if (input.query) {
    const searchParameter = parameter(`%${input.query}%`);
    conditions.push(`(
      p.product_code ILIKE ${searchParameter}
      OR p.name ILIKE ${searchParameter}
      OR p.category ILIKE ${searchParameter}
      OR p.subcategory ILIKE ${searchParameter}
      OR COALESCE(p.brand, '') ILIKE ${searchParameter}
      OR COALESCE(p.product_size, '') ILIKE ${searchParameter}
      OR p.unit_of_measure ILIKE ${searchParameter}
      OR COALESCE(p.packaging, '') ILIKE ${searchParameter}
      OR COALESCE(p.description, '') ILIKE ${searchParameter}
    )`);
  }

  const facetConditions = [...conditions];
  const facetValues = [...values];

  if (input.categories.length) {
    conditions.push(
      `p.category = ANY(${parameter(input.categories)}::text[])`,
    );
  }

  if (input.subcategories.length) {
    conditions.push(
      `p.subcategory = ANY(${parameter(input.subcategories)}::text[])`,
    );
  }

  if (input.brands.length) {
    conditions.push(
      `p.brand = ANY(${parameter(input.brands)}::text[])`,
    );
  }

  if (input.units.length) {
    conditions.push(
      `p.unit_of_measure = ANY(${parameter(input.units)}::text[])`,
    );
  }

  if (input.minPrice !== undefined) {
    conditions.push(
      `p.default_sell_price >= ${parameter(input.minPrice)}`,
    );
  }

  if (input.maxPrice !== undefined) {
    conditions.push(
      `p.default_sell_price <= ${parameter(input.maxPrice)}`,
    );
  }

  if (input.maxDeliveryDays !== undefined) {
    conditions.push(
      `p.delivery_sla_days <= ${parameter(
        input.maxDeliveryDays,
      )}`,
    );
  }

  const where = conditions.join(" AND ");
  const facetWhere = facetConditions.join(" AND ");
  const filterValues = [...values];

  const sortExpressions: Record<CatalogSort, string> = {
    relevance: input.query
      ? `CASE
          WHEN LOWER(p.product_code)=LOWER(${parameter(input.query)}) THEN 0
          WHEN LOWER(p.name)=LOWER($${values.length}) THEN 1
          WHEN LOWER(p.name) LIKE LOWER($${values.length}) || '%' THEN 2
          WHEN LOWER(p.product_code) LIKE LOWER($${values.length}) || '%' THEN 3
          ELSE 4
        END, p.name`
      : "p.name",
    "name-asc": "p.name",
    "price-asc": "p.default_sell_price, p.name",
    "price-desc": "p.default_sell_price DESC, p.name",
    "delivery-asc": "p.delivery_sla_days, p.name",
    "moq-asc": "p.minimum_order_quantity, p.name",
  };

  const offset = (input.page - 1) * input.limit;
  const limitParameter = parameter(input.limit);
  const offsetParameter = parameter(offset);

  const [
    productsResult,
    totalResult,
    categoryResult,
    subcategoryResult,
    brandResult,
    unitResult,
    priceResult,
  ] = await Promise.all([
    query<Product>(
      `SELECT
        p.id::text,
        p.company_id::text AS "companyId",
        c.name AS "companyName",
        p.product_code AS code,
        p.name,
        p.category,
        p.subcategory,
        p.brand,
        p.product_size AS size,
        p.unit_of_measure AS unit,
        p.packaging,
        p.description,
        0::float8 AS "defaultBuyPrice",
        p.default_sell_price::float8 AS "defaultSellPrice",
        p.minimum_order_quantity::float8 AS "minimumOrderQuantity",
        p.delivery_sla_days AS "deliverySlaDays",
        NULL::text AS "preferredSupplierId",
        NULL::text AS "preferredSupplierName",
        (p.image_content IS NOT NULL) AS "hasImage",
        p.image_alt_text AS "imageAltText",
        'Active'::text AS status,
        false AS "duplicateWarning"
      FROM products p
      LEFT JOIN companies c ON c.id=p.company_id
      WHERE ${where}
      ORDER BY ${sortExpressions[input.sort]}
      LIMIT ${limitParameter}
      OFFSET ${offsetParameter}`,
      values,
    ),
    query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM products p
       WHERE ${where}`,
      filterValues,
    ),
    query<CatalogFacetOption>(
      `SELECT p.category AS value, COUNT(*)::int AS count
       FROM products p
       WHERE ${facetWhere}
       GROUP BY p.category
       ORDER BY p.category`,
      facetValues,
    ),
    query<CatalogFacetOption>(
      `SELECT p.subcategory AS value, COUNT(*)::int AS count
       FROM products p
       WHERE ${facetWhere}
       GROUP BY p.subcategory
       ORDER BY p.subcategory`,
      facetValues,
    ),
    query<CatalogFacetOption>(
      `SELECT p.brand AS value, COUNT(*)::int AS count
       FROM products p
       WHERE ${facetWhere} AND p.brand IS NOT NULL
       GROUP BY p.brand
       ORDER BY p.brand`,
      facetValues,
    ),
    query<CatalogFacetOption>(
      `SELECT p.unit_of_measure AS value, COUNT(*)::int AS count
       FROM products p
       WHERE ${facetWhere}
       GROUP BY p.unit_of_measure
       ORDER BY p.unit_of_measure`,
      facetValues,
    ),
    query<{ minimumPrice: number; maximumPrice: number }>(
      `SELECT
         COALESCE(MIN(p.default_sell_price), 0)::float8 AS "minimumPrice",
         COALESCE(MAX(p.default_sell_price), 0)::float8 AS "maximumPrice"
       FROM products p
       WHERE ${facetWhere}`,
      facetValues,
    ),
  ]);

  const total = Number(totalResult.rows[0]?.total ?? 0);
  const price = priceResult.rows[0];

  return {
    products: productsResult.rows,
    total,
    page: input.page,
    limit: input.limit,
    totalPages: Math.max(Math.ceil(total / input.limit), 1),
    facets: {
      categories: categoryResult.rows,
      subcategories: subcategoryResult.rows,
      brands: brandResult.rows,
      units: unitResult.rows,
      minimumPrice: Number(price?.minimumPrice ?? 0),
      maximumPrice: Number(price?.maximumPrice ?? 0),
    },
  };
}

export async function getCatalogProductById(
  productId: string,
  providedActor?: SessionUser,
): Promise<Product | undefined> {
  const actor = providedActor ?? await requireSession();

  if (!canAccess(actor, "view_catalog")) {
    throw new Error(
      "Your account cannot view the product catalog.",
    );
  }

  if (isDemoMode()) {
    const product = getDemoStore().products.find(
      (item) =>
        item.id === productId &&
        item.status === "Active" &&
        !item.duplicateWarning &&
        (
          actor.isOwner ||
          !item.companyId ||
          item.companyId === actor.companyId
        ),
    );

    if (!product) return undefined;

    return {
      ...product,
      defaultBuyPrice: 0,
      preferredSupplierId: undefined,
      preferredSupplierName: undefined,
      duplicateWarning: false,
    };
  }

  const values: unknown[] = [productId];
  const conditions = [
    "p.id=$1",
    "p.active=true",
    "p.needs_review=false",
  ];

  if (!actor.isOwner) {
    values.push(actor.companyId);
    conditions.push(
      "(p.company_id IS NULL OR p.company_id=$2)",
    );
  }

  const result = await query<Product>(
    `SELECT
      p.id::text,
      p.company_id::text AS "companyId",
      c.name AS "companyName",
      p.product_code AS code,
      p.name,
      p.category,
      p.subcategory,
      p.brand,
      p.product_size AS size,
      p.unit_of_measure AS unit,
      p.packaging,
      p.description,
      0::float8 AS "defaultBuyPrice",
      p.default_sell_price::float8 AS "defaultSellPrice",
      p.minimum_order_quantity::float8 AS "minimumOrderQuantity",
      p.delivery_sla_days AS "deliverySlaDays",
      NULL::text AS "preferredSupplierId",
      NULL::text AS "preferredSupplierName",
      (p.image_content IS NOT NULL) AS "hasImage",
      p.image_alt_text AS "imageAltText",
      'Active'::text AS status,
      false AS "duplicateWarning"
    FROM products p
    LEFT JOIN companies c ON c.id=p.company_id
    WHERE ${conditions.join(" AND ")}
    LIMIT 1`,
    values,
  );

  return result.rows[0];
}
