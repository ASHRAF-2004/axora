import type { Product } from "./types";

export type CatalogSort =
  | "relevance"
  | "name-asc"
  | "price-asc"
  | "price-desc"
  | "delivery-asc"
  | "moq-asc";

export const CATALOG_SORTS: readonly CatalogSort[] = [
  "relevance",
  "name-asc",
  "price-asc",
  "price-desc",
  "delivery-asc",
  "moq-asc",
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

export interface ShopSubcategorySummary {
  name: string;
  count: number;
  sampleProduct: Product;
}

export interface ShopCategorySummary {
  name: string;
  count: number;
  sampleProduct: Product;
  subcategories: ShopSubcategorySummary[];
}
