export type CatalogSort =
  | "relevance"
  | "name-asc"
  | "price-asc"
  | "price-desc"
  | "delivery-asc";

export const CATALOG_SORTS: readonly CatalogSort[] = [
  "relevance",
  "name-asc",
  "price-asc",
  "price-desc",
  "delivery-asc",
];

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

/**
 * The only product representation that may cross into a customer browser.
 * `publicRef` is a dedicated opaque customer reference; database UUIDs,
 * internal product codes and all supplier,
 * cost, margin and purchasing fields intentionally do not exist here.
 */
export interface CustomerCatalogProduct {
  publicRef: string;
  name: string;
  category: string;
  subcategory: string;
  brand?: string;
  size?: string;
  unit: string;
  description?: string;
  defaultSellPrice: number;
  priceRuleVersion?: number;
  priceEffectiveFrom?: string;
  priceChangedAt?: string;
  priceCurrency?: string;
  deliverySlaDays: number;
  hasImage: boolean;
  imageAltText?: string;
}

export interface CatalogSearchResult {
  products: CustomerCatalogProduct[];
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

export interface ShopSubcategorySummary {
  name: string;
  count: number;
  sampleProduct: CustomerCatalogProduct;
}

export interface ShopCategorySummary {
  name: string;
  count: number;
  sampleProduct: CustomerCatalogProduct;
  subcategories: ShopSubcategorySummary[];
}
