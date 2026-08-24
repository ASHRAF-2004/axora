import { requireSession, type SessionUser } from "./auth";
import { isDemoMode, query } from "./db";
import { getDemoStore } from "./demo-data";
import { canAccess } from "./permissions";
import type { Product } from "./types";
import { withDemoCommercialDefaults } from "./procurement-rules";
import { getCatalogPurchasingScope } from "./procurement-cart";
import {
  CATALOG_SORTS,
  type CatalogFacetOption,
  type CustomerCatalogProduct,
  type CatalogSearchInput,
  type CatalogSearchResult,
  type CatalogSort,
  type ShopCategorySummary,
} from "./catalog-contracts";

export { CATALOG_SORTS };
export type {
  CatalogFacetOption,
  CatalogSearchInput,
  CatalogSearchResult,
  CatalogSort,
  CustomerCatalogProduct,
  ShopCategorySummary,
  ShopSubcategorySummary,
} from "./catalog-contracts";

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
    branchId: input.branchId?.trim() || undefined,
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
    sort: CATALOG_SORTS.includes(input.sort as CatalogSort)
      ? input.sort!
      : "relevance",
    page,
    limit,
  };
}

export const catalogInternals = { normalizeInput };

function customerProductReference(product: Pick<Product,"name" | "publicReference">) {
  if (product.publicReference) return product.publicReference;
  const slug = product.name.normalize("NFKD").toLowerCase()
    .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,64);
  return `demo-${slug || "catalog-item"}`;
}

export function customerCatalogProduct(product: Product): CustomerCatalogProduct {
  return {
    publicRef: customerProductReference(product),
    name: product.name,
    category: product.category,
    subcategory: product.subcategory,
    brand: product.brand,
    size: product.size,
    unit: product.unit,
    description: product.description,
    defaultSellPrice: product.defaultSellPrice,
    priceRuleVersion: product.priceRuleVersion,
    priceEffectiveFrom: product.priceEffectiveFrom,
    priceChangedAt: product.priceChangedAt,
    priceCurrency: product.priceCurrency,
    deliverySlaDays: product.deliverySlaDays,
    hasImage: product.hasImage,
    imageAltText: product.imageAltText,
  };
}

function searchableProductText(product: Product) {
  return [
    customerProductReference(product),
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

    if (sort === "relevance" && searchTerm) {
      const term = searchTerm.toLowerCase();

      function rank(product: Product) {
        if (customerProductReference(product).toLowerCase() === term) return 0;
        if (product.name.toLowerCase() === term) return 1;
        if (product.name.toLowerCase().startsWith(term)) return 2;
        if (customerProductReference(product).toLowerCase().startsWith(term)) return 3;
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
  ).map(withDemoCommercialDefaults);

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
      duplicateWarning: false,
    }));

  return {
    products: products.map(customerCatalogProduct),
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

  const input = normalizeInput(rawInput);
  const purchasingScope = input.branchId
    ? await getCatalogPurchasingScope(actor, input.branchId)
    : null;
  if (actor.accountKind === "COMPANY" && !purchasingScope) {
    throw new Error("An authorized shopping branch is required.");
  }

  if (isDemoMode()) {
    return searchDemoCatalog(actor, input);
  }
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
    const companyParameter = parameter(purchasingScope?.companyId ?? actor.companyId);
    conditions.push(
      `(p.company_id IS NULL OR p.company_id=${companyParameter})`,
    );
  }

  if (input.query) {
    const searchParameter = parameter(`%${input.query}%`);
    conditions.push(`(
      p.public_reference ILIKE ${searchParameter}
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

  if (purchasingScope) {
    conditions.push(
      `p.category = ANY(${parameter(purchasingScope.allowedCategories)}::text[])`,
    );
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
          WHEN LOWER(p.public_reference)=LOWER(${parameter(input.query)}) THEN 0
          WHEN LOWER(p.name)=LOWER($${values.length}) THEN 1
          WHEN LOWER(p.name) LIKE LOWER($${values.length}) || '%' THEN 2
          WHEN LOWER(p.public_reference) LIKE LOWER($${values.length}) || '%' THEN 3
          ELSE 4
        END, p.name`
      : "p.name",
    "name-asc": "p.name",
    "price-asc": "p.default_sell_price, p.name",
    "price-desc": "p.default_sell_price DESC, p.name",
    "delivery-asc": "p.delivery_sla_days, p.name",
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
        p.public_reference AS code,
        p.public_reference AS "publicReference",
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
        p.price_rule_version AS "priceRuleVersion",
        p.price_effective_from::text AS "priceEffectiveFrom",
        p.price_changed_at::text AS "priceChangedAt",p.price_currency AS "priceCurrency",
        p.delivery_sla_days AS "deliverySlaDays",
        p.has_image AS "hasImage",
        p.image_alt_text AS "imageAltText",
        'Active'::text AS status,
        false AS "duplicateWarning"
      FROM v_customer_catalog_products p
      LEFT JOIN companies c ON c.id=p.company_id
      WHERE ${where}
      ORDER BY ${sortExpressions[input.sort]}
      LIMIT ${limitParameter}
      OFFSET ${offsetParameter}`,
      values,
    ),
    query<{ total: number }>(
      `SELECT COUNT(*)::int AS total
       FROM v_customer_catalog_products p
       WHERE ${where}`,
      filterValues,
    ),
    query<CatalogFacetOption>(
      `SELECT p.category AS value, COUNT(*)::int AS count
       FROM v_customer_catalog_products p
       WHERE ${facetWhere}
       GROUP BY p.category
       ORDER BY p.category`,
      facetValues,
    ),
    query<CatalogFacetOption>(
      `SELECT p.subcategory AS value, COUNT(*)::int AS count
       FROM v_customer_catalog_products p
       WHERE ${facetWhere}
       GROUP BY p.subcategory
       ORDER BY p.subcategory`,
      facetValues,
    ),
    query<CatalogFacetOption>(
      `SELECT p.brand AS value, COUNT(*)::int AS count
       FROM v_customer_catalog_products p
       WHERE ${facetWhere} AND p.brand IS NOT NULL
       GROUP BY p.brand
       ORDER BY p.brand`,
      facetValues,
    ),
    query<CatalogFacetOption>(
      `SELECT p.unit_of_measure AS value, COUNT(*)::int AS count
       FROM v_customer_catalog_products p
       WHERE ${facetWhere}
       GROUP BY p.unit_of_measure
       ORDER BY p.unit_of_measure`,
      facetValues,
    ),
    query<{ minimumPrice: number; maximumPrice: number }>(
      `SELECT
         COALESCE(MIN(p.default_sell_price), 0)::float8 AS "minimumPrice",
         COALESCE(MAX(p.default_sell_price), 0)::float8 AS "maximumPrice"
       FROM v_customer_catalog_products p
       WHERE ${facetWhere}`,
      facetValues,
    ),
  ]);

  const total = Number(totalResult.rows[0]?.total ?? 0);
  const price = priceResult.rows[0];

  return {
    products: productsResult.rows.map(customerCatalogProduct),
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
      ...withDemoCommercialDefaults(product),
      defaultBuyPrice: 0,
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
      p.public_reference AS code,
      p.public_reference AS "publicReference",
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
      p.price_rule_version AS "priceRuleVersion",p.price_effective_from::text AS "priceEffectiveFrom",
      p.price_changed_at::text AS "priceChangedAt",p.price_currency AS "priceCurrency",
      p.delivery_sla_days AS "deliverySlaDays",
      p.has_image AS "hasImage",
      p.image_alt_text AS "imageAltText",
      'Active'::text AS status,
      false AS "duplicateWarning"
    FROM v_customer_catalog_products p
    LEFT JOIN companies c ON c.id=p.company_id
    WHERE ${conditions.join(" AND ")}
    LIMIT 1`,
    values,
  );

  return result.rows[0];
}

export async function getCatalogProductsByIds(
  productIds: string[],
  providedActor?: SessionUser,
): Promise<Product[]> {
  const actor = providedActor ?? await requireSession();

  if (!canAccess(actor, "view_catalog")) {
    throw new Error(
      "Your account cannot view the product catalog.",
    );
  }

  const ids = [
    ...new Set(
      productIds
        .map((id) => id.trim())
        .filter(Boolean),
    ),
  ].slice(0, 100);

  if (!ids.length) return [];

  if (isDemoMode()) {
    const visibleProducts: Product[] = getDemoStore().products
      .filter(
        (product) =>
          product.status === "Active" &&
          !product.duplicateWarning &&
          (
            actor.isOwner ||
            !product.companyId ||
            product.companyId === actor.companyId
          ),
      )
      .map((product): Product => ({
        ...withDemoCommercialDefaults(product),
        defaultBuyPrice: 0,
        duplicateWarning: false,
      }));

    const visible = new Map<string, Product>(
      visibleProducts.map((product) => [
        product.id,
        product,
      ]),
    );

    return ids.flatMap((id) => {
      const product = visible.get(id);
      return product ? [product] : [];
    });
  }

  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  const validIds = ids.filter((id) => uuidPattern.test(id));

  if (!validIds.length) return [];
  if (!actor.isOwner && !actor.companyId) return [];

  const values: unknown[] = [validIds];
  const conditions = [
    "p.id = ANY($1::uuid[])",
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
      p.public_reference AS code,
      p.public_reference AS "publicReference",
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
      p.price_rule_version AS "priceRuleVersion",p.price_effective_from::text AS "priceEffectiveFrom",
      p.price_changed_at::text AS "priceChangedAt",p.price_currency AS "priceCurrency",
      p.delivery_sla_days AS "deliverySlaDays",
      p.has_image AS "hasImage",
      p.image_alt_text AS "imageAltText",
      'Active'::text AS status,
      false AS "duplicateWarning"
    FROM v_customer_catalog_products p
    LEFT JOIN companies c ON c.id=p.company_id
    WHERE ${conditions.join(" AND ")}`,
    values,
  );

  const byId = new Map(
    result.rows.map((product) => [product.id, product]),
  );

  return ids
    .map((id) => byId.get(id))
    .filter((product): product is Product => Boolean(product));
}

export async function getCatalogProductsByPublicRefs(
  productRefs: string[],
  providedActor?: SessionUser,
): Promise<Product[]> {
  const actor = providedActor ?? await requireSession();
  if (!canAccess(actor, "view_catalog")) {
    throw new Error("Your account cannot view the product catalog.");
  }
  const refs = [...new Set(productRefs.map((value) => value.trim()).filter(Boolean))].slice(0, 100);
  if (!refs.length) return [];

  if (isDemoMode()) {
    const byRef = new Map(
      getDemoStore().products
        .filter((product) => product.status === "Active" && !product.duplicateWarning
          && (actor.isOwner || !product.companyId || product.companyId === actor.companyId))
        .map((product) => {
          const normalized = withDemoCommercialDefaults(product);
          return [customerProductReference(normalized), { ...normalized, defaultBuyPrice: 0, duplicateWarning: false } as Product];
        }),
    );
    return refs.flatMap((ref) => {
      const product = byRef.get(ref);
      return product ? [product] : [];
    });
  }

  if (!actor.isOwner && !actor.companyId) return [];
  const values: unknown[] = [refs];
  const conditions = [
    "p.public_reference = ANY($1::text[])",
    "p.active=true",
    "p.needs_review=false",
  ];
  if (!actor.isOwner) {
    values.push(actor.companyId);
    conditions.push("(p.company_id IS NULL OR p.company_id=$2)");
  }
  const result = await query<Product>(
    `SELECT p.id::text,p.company_id::text AS "companyId",c.name AS "companyName",
      p.public_reference AS code,p.public_reference AS "publicReference",p.name,p.category,p.subcategory,p.brand,
      p.product_size AS size,p.unit_of_measure AS unit,p.packaging,p.description,
      0::float8 AS "defaultBuyPrice",p.default_sell_price::float8 AS "defaultSellPrice",
      p.price_rule_version AS "priceRuleVersion",p.price_effective_from::text AS "priceEffectiveFrom",
      p.price_changed_at::text AS "priceChangedAt",p.price_currency AS "priceCurrency",
      p.delivery_sla_days AS "deliverySlaDays",p.has_image AS "hasImage",
      p.image_alt_text AS "imageAltText",'Active'::text AS status,
      false AS "duplicateWarning"
    FROM v_customer_catalog_products p
    LEFT JOIN companies c ON c.id=p.company_id
    WHERE ${conditions.join(" AND ")}`,
    values,
  );
  const byRef = new Map(result.rows.map((product) => [customerProductReference(product), product]));
  return refs.flatMap((ref) => {
    const product = byRef.get(ref);
    return product ? [product] : [];
  });
}

export async function getCustomerCatalogProductsByPublicRefs(
  productRefs: string[],
  providedActor?: SessionUser,
) {
  return (await getCatalogProductsByPublicRefs(productRefs, providedActor))
    .map(customerCatalogProduct);
}

export async function getCustomerCatalogProductByPublicRef(
  productRef: string,
  providedActor?: SessionUser,
) {
  return (await getCustomerCatalogProductsByPublicRefs([productRef], providedActor))[0];
}

function shopSafeProduct(product: Product): CustomerCatalogProduct {
  return customerCatalogProduct({
    ...withDemoCommercialDefaults(product),
    defaultBuyPrice: 0,
    duplicateWarning: false,
  });
}

export async function listShopDepartments(
  providedActor?: SessionUser,
  branchId?: string,
): Promise<ShopCategorySummary[]> {
  const actor = providedActor ?? await requireSession();

  if (!canAccess(actor, "view_catalog")) {
    throw new Error(
      "Your account cannot view the product catalog.",
    );
  }

  const purchasingScope = branchId
    ? await getCatalogPurchasingScope(actor, branchId)
    : null;
  if (actor.accountKind === "COMPANY" && !purchasingScope) return [];

  if (isDemoMode()) {
    const visibleProducts = getDemoStore().products.filter(
      (product) =>
        product.status === "Active" &&
        !product.duplicateWarning &&
        (
          actor.isOwner ||
          !product.companyId ||
          product.companyId === actor.companyId
        ),
    );

    const categories = new Map<
      string,
      Map<string, Product[]>
    >();

    for (const product of visibleProducts) {
      const subcategories =
        categories.get(product.category) ??
        new Map<string, Product[]>();

      const products =
        subcategories.get(product.subcategory) ?? [];

      products.push(product);
      subcategories.set(product.subcategory, products);
      categories.set(product.category, subcategories);
    }

    return [...categories.entries()]
      .map(([categoryName, subcategoryMap]) => {
        const subcategories = [...subcategoryMap.entries()]
          .map(([subcategoryName, products]) => {
            const sample =
              [...products].sort(
                (left, right) =>
                  Number(right.hasImage) -
                    Number(left.hasImage) ||
                  left.name.localeCompare(right.name),
              )[0];

            return {
              name: subcategoryName,
              count: products.length,
              sampleProduct: shopSafeProduct(sample),
            };
          })
          .sort((left, right) =>
            left.name.localeCompare(right.name),
          );

        const sampleProduct =
          [...subcategories]
            .sort(
              (left, right) =>
                Number(right.sampleProduct.hasImage) -
                  Number(left.sampleProduct.hasImage) ||
                right.count - left.count,
            )[0]?.sampleProduct;

        return {
          name: categoryName,
          count: subcategories.reduce(
            (total, subcategory) =>
              total + subcategory.count,
            0,
          ),
          sampleProduct,
          subcategories,
        };
      })
      .filter(
        (
          category,
        ): category is ShopCategorySummary =>
          Boolean(category.sampleProduct),
      )
      .sort((left, right) =>
        left.name.localeCompare(right.name),
      );
  }

  interface ShopDepartmentRow {
    category: string;
    subcategory: string;
    categoryCount: number;
    subcategoryCount: number;
    id: string;
    companyId?: string;
    companyName?: string;
    code: string;
    name: string;
    brand?: string;
    size?: string;
    unit: string;
    packaging?: string;
    description?: string;
    defaultSellPrice: number;
    priceRuleVersion: number;
    priceEffectiveFrom: string;
    priceChangedAt: string;
    priceCurrency: string;
    deliverySlaDays: number;
    hasImage: boolean;
    imageAltText?: string;
  }

  const values: unknown[] = [];
  const conditions = [
    "p.active=true",
    "p.needs_review=false",
  ];

  if (!actor.isOwner) {
    values.push(purchasingScope?.companyId ?? actor.companyId);
    conditions.push(
      "(p.company_id IS NULL OR p.company_id=$1)",
    );
  }
  if (purchasingScope) {
    values.push(purchasingScope.allowedCategories);
    conditions.push(`p.category = ANY($${values.length}::text[])`);
  }

  const result = await query<ShopDepartmentRow>(
    `WITH ranked_products AS (
      SELECT
        p.id,
        p.company_id,
        c.name AS company_name,
        p.public_reference,
        p.name,
        p.category,
        p.subcategory,
        p.brand,
        p.product_size,
        p.unit_of_measure,
        p.packaging,
        p.description,
        p.default_sell_price,
        p.price_rule_version,
        p.price_effective_from,
        p.price_changed_at,
        p.price_currency,
        p.delivery_sla_days,
        p.has_image,
        p.image_alt_text,
        COUNT(*) OVER (
          PARTITION BY p.category
        )::int AS category_count,
        COUNT(*) OVER (
          PARTITION BY p.category, p.subcategory
        )::int AS subcategory_count,
        ROW_NUMBER() OVER (
          PARTITION BY p.category, p.subcategory
          ORDER BY
            p.has_image DESC,
            p.name
        ) AS sample_rank
      FROM v_customer_catalog_products p
      LEFT JOIN companies c ON c.id=p.company_id
      WHERE ${conditions.join(" AND ")}
    )
    SELECT
      id::text,
      company_id::text AS "companyId",
      company_name AS "companyName",
      public_reference AS code,
      public_reference AS "publicReference",
      name,
      category,
      subcategory,
      brand,
      product_size AS size,
      unit_of_measure AS unit,
      packaging,
      description,
      default_sell_price::float8 AS "defaultSellPrice",
      price_rule_version AS "priceRuleVersion",price_effective_from::text AS "priceEffectiveFrom",
      price_changed_at::text AS "priceChangedAt",price_currency AS "priceCurrency",
      delivery_sla_days AS "deliverySlaDays",
      has_image AS "hasImage",
      image_alt_text AS "imageAltText",
      category_count AS "categoryCount",
      subcategory_count AS "subcategoryCount"
    FROM ranked_products
    WHERE sample_rank=1
    ORDER BY category, subcategory`,
    values,
  );

  const categories = new Map<string, ShopCategorySummary>();

  for (const row of result.rows) {
    const sampleProduct = customerCatalogProduct({
      id: row.id,
      companyId: row.companyId,
      companyName: row.companyName,
      code: row.code,
      name: row.name,
      category: row.category,
      subcategory: row.subcategory,
      brand: row.brand,
      size: row.size,
      unit: row.unit,
      packaging: row.packaging,
      description: row.description,
      defaultBuyPrice: 0,
      defaultSellPrice: Number(row.defaultSellPrice),
      priceRuleVersion: Number(row.priceRuleVersion),
      priceEffectiveFrom: row.priceEffectiveFrom,
      priceChangedAt: row.priceChangedAt,
      priceCurrency: row.priceCurrency,
      deliverySlaDays: row.deliverySlaDays,
      hasImage: row.hasImage,
      imageAltText: row.imageAltText,
      status: "Active",
      duplicateWarning: false,
    });

    const existing = categories.get(row.category);

    if (existing) {
      existing.subcategories.push({
        name: row.subcategory,
        count: Number(row.subcategoryCount),
        sampleProduct,
      });

      if (
        !existing.sampleProduct.hasImage &&
        sampleProduct.hasImage
      ) {
        existing.sampleProduct = sampleProduct;
      }

      continue;
    }

    categories.set(row.category, {
      name: row.category,
      count: Number(row.categoryCount),
      sampleProduct,
      subcategories: [
        {
          name: row.subcategory,
          count: Number(row.subcategoryCount),
          sampleProduct,
        },
      ],
    });
  }

  return [...categories.values()];
}
