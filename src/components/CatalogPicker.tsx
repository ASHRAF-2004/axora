"use client";

import type {
  CatalogFacetOption,
  CatalogSearchResult,
  CatalogSort,
} from "@/lib/catalog";
import { formatCurrency } from "@/lib/domain";
import type { Product } from "@/lib/types";
import {
  Check,
  Filter,
  LoaderCircle,
  PackageSearch,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ProductImage } from "./ProductImage";

interface CatalogPickerProps {
  initialCatalog: CatalogSearchResult;
  selectedProductIds: string[];
  onToggleProduct: (product: Product) => void;
}

interface FacetGroupProps {
  title: string;
  options: CatalogFacetOption[];
  selected: string[];
  onToggle: (value: string) => void;
}

function FacetGroup({
  title,
  options,
  selected,
  onToggle,
}: FacetGroupProps) {
  if (!options.length) return null;

  return (
    <fieldset className="catalog-facet-group">
      <legend>{title}</legend>

      <div className="catalog-facet-options">
        {options.map((option) => (
          <label key={option.value} className="catalog-facet-option">
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              onChange={() => onToggle(option.value)}
            />

            <span>{option.value}</span>
            <small>{option.count}</small>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function toggleListValue(
  current: string[],
  value: string,
) {
  return current.includes(value)
    ? current.filter((item) => item !== value)
    : [...current, value];
}

export function CatalogPicker({
  initialCatalog,
  selectedProductIds,
  onToggleProduct,
}: CatalogPickerProps) {
  const [catalog, setCatalog] =
    useState<CatalogSearchResult>(initialCatalog);

  const [products, setProducts] = useState<Product[]>(
    initialCatalog.products,
  );

  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");

  const [categories, setCategories] = useState<string[]>([]);
  const [subcategories, setSubcategories] = useState<string[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [units, setUnits] = useState<string[]>([]);

  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const [maxDeliveryDays, setMaxDeliveryDays] = useState("");

  const [sort, setSort] =
    useState<CatalogSort>("relevance");

  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const firstRequest = useRef(true);

  const selectedSet = useMemo(
    () => new Set(selectedProductIds),
    [selectedProductIds],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(draftQuery.trim());
    }, 350);

    return () => window.clearTimeout(timer);
  }, [draftQuery]);

  const buildSearchParams = useCallback(
    (page: number) => {
      const params = new URLSearchParams({
        page: String(page),
        limit: "24",
        sort,
      });

      if (query) params.set("q", query);

      for (const category of categories) {
        params.append("category", category);
      }

      for (const subcategory of subcategories) {
        params.append("subcategory", subcategory);
      }

      for (const brand of brands) {
        params.append("brand", brand);
      }

      for (const unit of units) {
        params.append("unit", unit);
      }

      if (minPrice) params.set("minPrice", minPrice);
      if (maxPrice) params.set("maxPrice", maxPrice);

      if (maxDeliveryDays) {
        params.set("maxDeliveryDays", maxDeliveryDays);
      }

      return params;
    },
    [
      brands,
      categories,
      maxDeliveryDays,
      maxPrice,
      minPrice,
      query,
      sort,
      subcategories,
      units,
    ],
  );

  const fetchCatalog = useCallback(
    async (
      page: number,
      append: boolean,
      signal?: AbortSignal,
    ) => {
      const response = await fetch(
        `/api/catalog?${buildSearchParams(page).toString()}`,
        {
          method: "GET",
          credentials: "same-origin",
          signal,
        },
      );

      const body = (await response.json()) as
        | CatalogSearchResult
        | { error?: string };

      if (!response.ok || !("products" in body)) {
        throw new Error(
          "error" in body && body.error
            ? body.error
            : "Unable to load the product catalog.",
        );
      }

      setCatalog(body);

      setProducts((current) => {
        if (!append) return body.products;

        const merged = new Map(
          current.map((product) => [product.id, product]),
        );

        for (const product of body.products) {
          merged.set(product.id, product);
        }

        return [...merged.values()];
      });
    },
    [buildSearchParams],
  );

  useEffect(() => {
    if (firstRequest.current) {
      firstRequest.current = false;
      return;
    }

    const controller = new AbortController();

    setIsLoading(true);
    setCatalogError("");

    fetchCatalog(1, false, controller.signal)
      .catch((error: unknown) => {
        if (
          error instanceof DOMException &&
          error.name === "AbortError"
        ) {
          return;
        }

        setCatalogError(
          error instanceof Error
            ? error.message
            : "Unable to load the product catalog.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      });

    return () => controller.abort();
  }, [fetchCatalog]);

  async function loadMore() {
    if (
      isLoadingMore ||
      catalog.page >= catalog.totalPages
    ) {
      return;
    }

    setIsLoadingMore(true);
    setCatalogError("");

    try {
      await fetchCatalog(catalog.page + 1, true);
    } catch (error) {
      setCatalogError(
        error instanceof Error
          ? error.message
          : "Unable to load more products.",
      );
    } finally {
      setIsLoadingMore(false);
    }
  }

  function clearFilters() {
    setCategories([]);
    setSubcategories([]);
    setBrands([]);
    setUnits([]);
    setMinPrice("");
    setMaxPrice("");
    setMaxDeliveryDays("");
  }

  const activeFilters = [
    ...categories.map((value) => ({
      key: `category-${value}`,
      label: `Category: ${value}`,
      remove: () =>
        setCategories((current) =>
          current.filter((item) => item !== value),
        ),
    })),
    ...subcategories.map((value) => ({
      key: `subcategory-${value}`,
      label: `Subcategory: ${value}`,
      remove: () =>
        setSubcategories((current) =>
          current.filter((item) => item !== value),
        ),
    })),
    ...brands.map((value) => ({
      key: `brand-${value}`,
      label: `Brand: ${value}`,
      remove: () =>
        setBrands((current) =>
          current.filter((item) => item !== value),
        ),
    })),
    ...units.map((value) => ({
      key: `unit-${value}`,
      label: `Unit: ${value}`,
      remove: () =>
        setUnits((current) =>
          current.filter((item) => item !== value),
        ),
    })),
    ...(minPrice
      ? [
          {
            key: "minimum-price",
            label: `From ${formatCurrency(Number(minPrice))}`,
            remove: () => setMinPrice(""),
          },
        ]
      : []),
    ...(maxPrice
      ? [
          {
            key: "maximum-price",
            label: `Up to ${formatCurrency(Number(maxPrice))}`,
            remove: () => setMaxPrice(""),
          },
        ]
      : []),
    ...(maxDeliveryDays
      ? [
          {
            key: "delivery",
            label: `Delivery within ${maxDeliveryDays} days`,
            remove: () => setMaxDeliveryDays(""),
          },
        ]
      : []),
  ];

  const loadedCount = Math.min(products.length, catalog.total);

  return (
    <section className="catalog-shop">
      <div className="catalog-search-shell">
        <Search size={21} aria-hidden="true" />

        <input
          type="search"
          value={draftQuery}
          onChange={(event) =>
            setDraftQuery(event.target.value)
          }
          placeholder="Search products, codes, brands, categories, sizes…"
          aria-label="Search product catalog"
        />

        {draftQuery ? (
          <button
            type="button"
            className="catalog-search-clear"
            data-ux-silent="true"
            aria-label="Clear catalog search"
            onClick={() => {
              setDraftQuery("");
              setQuery("");
            }}
          >
            <X size={17} />
          </button>
        ) : null}
      </div>

      {catalog.facets.categories.length ? (
        <div className="catalog-category-section">
          <div className="catalog-section-heading">
            <div>
              <span>Browse departments</span>
              <h3>Shop by category</h3>
            </div>
          </div>

          <div className="catalog-category-strip">
            {catalog.facets.categories
              .slice(0, 10)
              .map((category) => {
                const active = categories.includes(
                  category.value,
                );

                return (
                  <button
                    key={category.value}
                    type="button"
                    data-ux-silent="true"
                    className={
                      active
                        ? "catalog-category-card is-active"
                        : "catalog-category-card"
                    }
                    onClick={() =>
                      setCategories((current) =>
                        toggleListValue(
                          current,
                          category.value,
                        ),
                      )
                    }
                  >
                    <span>{category.value}</span>
                    <small>
                      {category.count}{" "}
                      {category.count === 1
                        ? "product"
                        : "products"}
                    </small>
                  </button>
                );
              })}
          </div>
        </div>
      ) : null}

      <div className="catalog-toolbar">
        <div>
          <strong>
            {catalog.total.toLocaleString()} products found
          </strong>

          <span>
            Showing {loadedCount.toLocaleString()} currently
          </span>
        </div>

        <div className="catalog-toolbar-actions">
          <button
            type="button"
            className="button button-secondary catalog-filter-toggle"
            data-ux-silent="true"
            onClick={() => setFiltersOpen(true)}
          >
            <SlidersHorizontal size={17} />
            Filters
            {activeFilters.length
              ? ` (${activeFilters.length})`
              : ""}
          </button>

          <label className="catalog-sort">
            <span>Sort</span>

            <select
              value={sort}
              onChange={(event) =>
                setSort(event.target.value as CatalogSort)
              }
            >
              <option value="relevance">Recommended</option>
              <option value="name-asc">Name: A–Z</option>
              <option value="price-asc">
                Price: low to high
              </option>
              <option value="price-desc">
                Price: high to low
              </option>
              <option value="delivery-asc">
                Fastest delivery
              </option>
              <option value="moq-asc">Lowest MOQ</option>
            </select>
          </label>
        </div>
      </div>

      {activeFilters.length ? (
        <div
          className="catalog-filter-chips"
          aria-label="Applied catalog filters"
        >
          {activeFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              data-ux-silent="true"
              onClick={filter.remove}
            >
              {filter.label}
              <X size={14} aria-hidden="true" />
            </button>
          ))}

          <button
            type="button"
            className="catalog-clear-filters"
            data-ux-silent="true"
            onClick={clearFilters}
          >
            Clear filters
          </button>
        </div>
      ) : null}

      <div className="catalog-layout">
        <button
          type="button"
          className={
            filtersOpen
              ? "catalog-filter-backdrop is-visible"
              : "catalog-filter-backdrop"
          }
          aria-label="Close catalog filters"
          data-ux-silent="true"
          onClick={() => setFiltersOpen(false)}
        />

        <aside
          className={
            filtersOpen
              ? "catalog-filter-panel is-open"
              : "catalog-filter-panel"
          }
          aria-label="Catalog filters"
        >
          <div className="catalog-filter-header">
            <div>
              <Filter size={18} aria-hidden="true" />
              <strong>Filter products</strong>
            </div>

            <button
              type="button"
              className="icon-button catalog-filter-close"
              aria-label="Close catalog filters"
              data-ux-silent="true"
              onClick={() => setFiltersOpen(false)}
            >
              <X size={18} />
            </button>
          </div>

          <FacetGroup
            title="Category"
            options={catalog.facets.categories}
            selected={categories}
            onToggle={(value) =>
              setCategories((current) =>
                toggleListValue(current, value),
              )
            }
          />

          <FacetGroup
            title="Subcategory"
            options={catalog.facets.subcategories}
            selected={subcategories}
            onToggle={(value) =>
              setSubcategories((current) =>
                toggleListValue(current, value),
              )
            }
          />

          <FacetGroup
            title="Brand"
            options={catalog.facets.brands}
            selected={brands}
            onToggle={(value) =>
              setBrands((current) =>
                toggleListValue(current, value),
              )
            }
          />

          <FacetGroup
            title="Unit"
            options={catalog.facets.units}
            selected={units}
            onToggle={(value) =>
              setUnits((current) =>
                toggleListValue(current, value),
              )
            }
          />

          <fieldset className="catalog-facet-group">
            <legend>Price range</legend>

            <div className="catalog-price-inputs">
              <label>
                Minimum
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={minPrice}
                  onChange={(event) =>
                    setMinPrice(event.target.value)
                  }
                  placeholder={String(
                    catalog.facets.minimumPrice,
                  )}
                />
              </label>

              <label>
                Maximum
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={maxPrice}
                  onChange={(event) =>
                    setMaxPrice(event.target.value)
                  }
                  placeholder={String(
                    catalog.facets.maximumPrice,
                  )}
                />
              </label>
            </div>
          </fieldset>

          <fieldset className="catalog-facet-group">
            <legend>Delivery speed</legend>

            <label>
              Maximum delivery days
              <input
                type="number"
                min="0"
                step="1"
                value={maxDeliveryDays}
                onChange={(event) =>
                  setMaxDeliveryDays(event.target.value)
                }
                placeholder="Any"
              />
            </label>
          </fieldset>

          {activeFilters.length ? (
            <button
              type="button"
              className="button button-secondary"
              data-ux-silent="true"
              onClick={clearFilters}
            >
              Clear all filters
            </button>
          ) : null}
        </aside>

        <div className="catalog-results">
          {catalogError ? (
            <div className="request-section-error" role="alert">
              {catalogError}

              <button
                type="button"
                className="button button-secondary"
                data-ux-silent="true"
                onClick={() =>
                  fetchCatalog(1, false).catch(() => undefined)
                }
              >
                Try again
              </button>
            </div>
          ) : null}

          <div
            className={
              isLoading
                ? "catalog-product-grid is-loading"
                : "catalog-product-grid"
            }
            aria-busy={isLoading}
          >
            {products.map((product) => {
              const selected = selectedSet.has(product.id);

              return (
                <article
                  className={
                    selected
                      ? "catalog-product-card is-selected"
                      : "catalog-product-card"
                  }
                  key={product.id}
                >
                  <div className="catalog-product-image">
                    <ProductImage product={product} />

                    {selected ? (
                      <span className="catalog-selected-badge">
                        <Check size={14} />
                        Added
                      </span>
                    ) : null}
                  </div>

                  <div className="catalog-product-content">
                    <div className="catalog-product-meta">
                      <span>{product.category}</span>
                      <small>{product.code}</small>
                    </div>

                    <h3>{product.name}</h3>

                    {product.brand || product.size ? (
                      <p className="catalog-product-variant">
                        {[product.brand, product.size]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    ) : null}

                    <div className="catalog-product-price">
                      <strong>
                        {formatCurrency(
                          product.defaultSellPrice,
                        )}
                      </strong>
                      <span>per {product.unit}</span>
                    </div>

                    <dl className="catalog-product-details">
                      <div>
                        <dt>Minimum</dt>
                        <dd>
                          {Math.max(
                            Math.ceil(
                              product.minimumOrderQuantity,
                            ),
                            1,
                          )}{" "}
                          {product.unit}
                        </dd>
                      </div>

                      <div>
                        <dt>Delivery</dt>
                        <dd>
                          {product.deliverySlaDays === 0
                            ? "Same day"
                            : `${product.deliverySlaDays} days`}
                        </dd>
                      </div>
                    </dl>

                    <button
                      type="button"
                      data-ux-silent="true"
                      className={
                        selected
                          ? "button button-primary"
                          : "button button-secondary"
                      }
                      onClick={() => onToggleProduct(product)}
                    >
                      {selected ? (
                        <>
                          <Check size={16} />
                          Added to request
                        </>
                      ) : (
                        <>
                          <ShoppingCart size={16} />
                          Add to request
                        </>
                      )}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>

          {!isLoading && !products.length ? (
            <div className="catalog-empty-state">
              <PackageSearch size={38} />
              <strong>No matching products</strong>
              <p>
                Try a different search or remove some filters.
              </p>

              <div>
                {query ? (
                  <button
                    type="button"
                    className="button button-secondary"
                    data-ux-silent="true"
                    onClick={() => {
                      setDraftQuery("");
                      setQuery("");
                    }}
                  >
                    Clear search
                  </button>
                ) : null}

                {activeFilters.length ? (
                  <button
                    type="button"
                    className="button button-primary"
                    data-ux-silent="true"
                    onClick={clearFilters}
                  >
                    Clear filters
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {catalog.page < catalog.totalPages ? (
            <div className="catalog-load-more">
              <span>
                Showing {loadedCount.toLocaleString()} of{" "}
                {catalog.total.toLocaleString()} products
              </span>

              <button
                type="button"
                className="button button-secondary"
                data-ux-silent="true"
                disabled={isLoadingMore}
                onClick={loadMore}
              >
                {isLoadingMore ? (
                  <>
                    <LoaderCircle
                      className="catalog-spinner"
                      size={17}
                    />
                    Loading products…
                  </>
                ) : (
                  "Load more products"
                )}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
