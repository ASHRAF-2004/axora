"use client";

import type {
  CatalogSearchResult,
  CatalogSort,
  ShopCategorySummary,
} from "@/lib/catalog";
import { formatCurrency, roundMoney } from "@/lib/domain";
import {
  addProductToRequestCart,
  readRequestCart,
  REQUEST_CART_EVENT,
  type RequestCartItem,
} from "@/lib/request-cart";
import type { Product } from "@/lib/types";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  Grid3X3,
  LoaderCircle,
  PackageSearch,
  Search,
  ShoppingBag,
  ShoppingCart,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { ProductImage } from "./ProductImage";
import { useUxFeedback } from "./UxFeedbackProvider";

function deliveryLabel(days: number) {
  if (days === 0) return "Same day";
  return `${days} day${days === 1 ? "" : "s"}`;
}

function minimumQuantity(product: Product) {
  return Math.max(Math.ceil(product.minimumOrderQuantity), 1);
}

export function ShopCategoryHub({
  departments,
  canRequest,
}: {
  departments: ShopCategorySummary[];
  canRequest: boolean;
}) {
  const [selectedCategory, setSelectedCategory] =
    useState<ShopCategorySummary | null>(null);

  const [selectedSubcategory, setSelectedSubcategory] =
    useState<string | null>(null);

  const [viewAllCategory, setViewAllCategory] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [query, setQuery] = useState("");
  const [sort, setSort] =
    useState<CatalogSort>("relevance");

  const [catalog, setCatalog] =
    useState<CatalogSearchResult | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [cartItems, setCartItems] =
    useState<RequestCartItem[]>([]);
  const { notify } = useUxFeedback();

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(searchText.trim());
    }, 350);

    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    function syncCart() {
      setCartItems(readRequestCart());
    }

    syncCart();
    window.addEventListener("storage", syncCart);
    window.addEventListener(REQUEST_CART_EVENT, syncCart);

    return () => {
      window.removeEventListener("storage", syncCart);
      window.removeEventListener(REQUEST_CART_EVENT, syncCart);
    };
  }, []);

  const showingProducts = Boolean(
    query || selectedSubcategory || viewAllCategory,
  );

  const buildParams = useCallback(
    (page: number) => {
      const params = new URLSearchParams({
        page: String(page),
        limit: "24",
        sort,
      });

      if (query) params.set("q", query);

      if (selectedCategory) {
        params.append("category", selectedCategory.name);
      }

      if (selectedSubcategory) {
        params.append("subcategory", selectedSubcategory);
      }

      return params;
    },
    [query, selectedCategory, selectedSubcategory, sort],
  );

  const loadProducts = useCallback(
    async (
      page: number,
      append: boolean,
      signal?: AbortSignal,
    ) => {
      const response = await fetch(
        `/api/catalog?${buildParams(page).toString()}`,
        {
          credentials: "same-origin",
          signal,
        },
      );

      const payload = (await response.json()) as
        | CatalogSearchResult
        | { error?: string };

      if (!response.ok || !("products" in payload)) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "Unable to load shop products.",
        );
      }

      setCatalog(payload);

      setProducts((current) => {
        if (!append) return payload.products;

        const merged = new Map(
          current.map((product) => [product.id, product]),
        );

        for (const product of payload.products) {
          merged.set(product.id, product);
        }

        return [...merged.values()];
      });
    },
    [buildParams],
  );

  useEffect(() => {
    if (!showingProducts) return;

    const controller = new AbortController();

    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");

      void loadProducts(1, false, controller.signal)
        .catch((loadError: unknown) => {
          if (
            loadError instanceof DOMException &&
            loadError.name === "AbortError"
          ) {
            return;
          }

          setError(
            loadError instanceof Error
              ? loadError.message
              : "Unable to load shop products.",
          );
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setLoading(false);
          }
        });
    }, 0);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadProducts, showingProducts]);

  function openCategory(category: ShopCategorySummary) {
    setSelectedCategory(category);
    setSelectedSubcategory(null);
    setViewAllCategory(false);
    setSearchText("");
    setQuery("");
    setSort("relevance");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function returnToDepartments() {
    setSelectedCategory(null);
    setSelectedSubcategory(null);
    setViewAllCategory(false);
    setSearchText("");
    setQuery("");
    setSort("relevance");
  }

  function openSubcategory(name: string) {
    setSelectedSubcategory(name);
    setViewAllCategory(false);
    setSort("relevance");
  }

  async function loadMore() {
    if (
      !catalog ||
      loadingMore ||
      catalog.page >= catalog.totalPages
    ) {
      return;
    }

    setLoadingMore(true);
    setError("");

    try {
      await loadProducts(catalog.page + 1, true);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load more products.",
      );
    } finally {
      setLoadingMore(false);
    }
  }

  const pageTitle = useMemo(() => {
    if (query) {
      return selectedCategory
        ? `Search in ${selectedCategory.name}`
        : "Search results";
    }

    if (selectedSubcategory) return selectedSubcategory;
    if (viewAllCategory) return `All ${selectedCategory?.name ?? ""}`;

    return "";
  }, [
    query,
    selectedCategory,
    selectedSubcategory,
    viewAllCategory,
  ]);

  const cartProductIds = useMemo(
    () => new Set(cartItems.map((item) => item.product.id)),
    [cartItems],
  );

  const cartQuantity = cartItems.reduce(
    (total, item) => total + item.quantity,
    0,
  );

  const cartSubtotal = cartItems.reduce(
    (total, item) =>
      total +
      roundMoney(
        item.quantity * item.product.defaultSellPrice,
      ),
    0,
  );

  function addToCart(product: Product) {
    const result = addProductToRequestCart(product);
    setCartItems(result.items);

    notify(
      result.added
        ? `${product.name} added to the request cart.`
        : `${product.name} is already in the request cart.`,
      result.added ? "success" : "info",
    );
  }

  return (
    <section className="shop-hub" aria-label="Axora shop">
      <div className="shop-search-hero">
        <div className="shop-search-copy">
          <span>Axora Shop</span>
          <h2>What does your branch need today?</h2>
          <p>
            Search directly or browse departments and
            subcategories visually.
          </p>
        </div>

        <div className="shop-search-box">
          <Search size={22} aria-hidden="true" />

          <input
            type="search"
            value={searchText}
            onChange={(event) =>
              setSearchText(event.target.value)
            }
            placeholder={
              selectedCategory
                ? `Search inside ${selectedCategory.name}`
                : "Search products, codes, brands, or categories"
            }
            aria-label="Search the Axora shop"
          />

          {searchText ? (
            <button
              type="button"
              aria-label="Clear shop search"
              data-ux-silent="true"
              onClick={() => {
                setSearchText("");
                setQuery("");
              }}
            >
              <X size={18} />
            </button>
          ) : null}
        </div>
      </div>

      {canRequest ? (
        <aside
          className={
            cartItems.length
              ? "shop-cart-bar has-items"
              : "shop-cart-bar"
          }
          aria-label="Purchase request cart"
        >
          <div className="shop-cart-bar-icon">
            <ShoppingCart size={21} aria-hidden="true" />
            {cartItems.length ? (
              <span>{cartItems.length}</span>
            ) : null}
          </div>

          <div className="shop-cart-bar-copy">
            <strong>
              {cartItems.length
                ? `${cartItems.length} ${
                    cartItems.length === 1 ? "item" : "items"
                  } in your request cart`
                : "Your request cart is empty"}
            </strong>
            <span>
              {cartItems.length
                ? `${cartQuantity} units · ${formatCurrency(
                    cartSubtotal,
                  )} subtotal`
                : "Add products, then review quantities before submitting."}
            </span>
          </div>

          <Link
            href="/requests/new?cart=1"
            className="button button-primary"
            aria-disabled={!cartItems.length}
            tabIndex={cartItems.length ? undefined : -1}
          >
            Review request
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </aside>
      ) : null}

      {selectedCategory ? (
        <nav className="shop-breadcrumb" aria-label="Shop breadcrumb">
          <button
            type="button"
            data-ux-silent="true"
            onClick={returnToDepartments}
          >
            Shop
          </button>

          <ChevronRight size={14} aria-hidden="true" />

          <button
            type="button"
            data-ux-silent="true"
            onClick={() => {
              setSelectedSubcategory(null);
              setViewAllCategory(false);
              setSearchText("");
              setQuery("");
            }}
          >
            {selectedCategory.name}
          </button>

          {selectedSubcategory ? (
            <>
              <ChevronRight size={14} aria-hidden="true" />
              <span>{selectedSubcategory}</span>
            </>
          ) : null}
        </nav>
      ) : null}

      {!selectedCategory && !query ? (
        <>
          <div className="shop-section-heading">
            <div>
              <span>Browse departments</span>
              <h2>Shop by category</h2>
              <p>
                Choose a department to view its subcategories.
              </p>
            </div>

            <strong>
              {departments.length}{" "}
              {departments.length === 1
                ? "department"
                : "departments"}
            </strong>
          </div>

          <div className="shop-department-grid">
            {departments.map((department) => (
              <button
                key={department.name}
                type="button"
                className="shop-department-card"
                data-ux-silent="true"
                onClick={() => openCategory(department)}
              >
                <div className="shop-department-image">
                  <ProductImage
                    product={department.sampleProduct}
                    showControls={false}
                  />

                  <span className="shop-department-count">
                    {department.count}{" "}
                    {department.count === 1
                      ? "product"
                      : "products"}
                  </span>
                </div>

                <div className="shop-department-content">
                  <h3>{department.name}</h3>

                  <div className="shop-subcategory-preview">
                    {department.subcategories
                      .slice(0, 5)
                      .map((subcategory) => (
                        <span key={subcategory.name}>
                          {subcategory.name}
                        </span>
                      ))}
                  </div>

                  <div className="shop-department-action">
                    Browse department
                    <ArrowRight size={17} aria-hidden="true" />
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : null}

      {selectedCategory &&
      !showingProducts &&
      !query ? (
        <>
          <div className="shop-category-banner">
            <button
              type="button"
              className="shop-back-button"
              data-ux-silent="true"
              onClick={returnToDepartments}
            >
              <ArrowLeft size={17} />
              All departments
            </button>

            <div>
              <span>Department</span>
              <h2>{selectedCategory.name}</h2>
              <p>
                Choose a subcategory or view every product in
                this department.
              </p>
            </div>

            <button
              type="button"
              className="button button-primary"
              data-ux-silent="true"
              onClick={() => {
                setSelectedSubcategory(null);
                setViewAllCategory(true);
              }}
            >
              <Grid3X3 size={17} />
              View all {selectedCategory.count} products
            </button>
          </div>

          <div className="shop-section-heading">
            <div>
              <span>{selectedCategory.name}</span>
              <h2>Choose a subcategory</h2>
            </div>
          </div>

          <div className="shop-subcategory-grid">
            {selectedCategory.subcategories.map(
              (subcategory) => (
                <button
                  key={subcategory.name}
                  type="button"
                  className="shop-subcategory-card"
                  data-ux-silent="true"
                  onClick={() =>
                    openSubcategory(subcategory.name)
                  }
                >
                  <div className="shop-subcategory-image">
                    <ProductImage
                      product={subcategory.sampleProduct}
                      showControls={false}
                    />
                  </div>

                  <div>
                    <h3>{subcategory.name}</h3>
                    <span>
                      {subcategory.count}{" "}
                      {subcategory.count === 1
                        ? "product"
                        : "products"}
                    </span>
                  </div>

                  <ChevronRight size={19} aria-hidden="true" />
                </button>
              ),
            )}
          </div>
        </>
      ) : null}

      {showingProducts ? (
        <div className="shop-product-view">
          <div className="shop-product-toolbar">
            <div>
              <button
                type="button"
                data-ux-silent="true"
                onClick={() => {
                  if (query) {
                    setSearchText("");
                    setQuery("");
                    return;
                  }

                  setSelectedSubcategory(null);
                  setViewAllCategory(false);
                }}
              >
                <ArrowLeft size={16} />
                Back
              </button>

              <h2>{pageTitle}</h2>

              <span aria-live="polite">
                {catalog
                  ? `${catalog.total.toLocaleString()} products found`
                  : "Loading products"}
              </span>
            </div>

            <label>
              Sort by
              <select
                value={sort}
                onChange={(event) =>
                  setSort(
                    event.target.value as CatalogSort,
                  )
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

          {error ? (
            <div className="request-section-error" role="alert">
              {error}
            </div>
          ) : null}

          <div
            className={
              loading
                ? "shop-product-grid is-loading"
                : "shop-product-grid"
            }
            aria-busy={loading}
          >
            {products.map((product) => (
              <article
                key={product.id}
                className="shop-product-card"
              >
                <div className="shop-product-image">
                  <ProductImage product={product} />
                </div>

                <div className="shop-product-content">
                  <div className="shop-product-meta">
                    <span>{product.subcategory}</span>
                    <small>{product.code}</small>
                  </div>

                  <h3>{product.name}</h3>

                  {product.brand || product.size ? (
                    <p>
                      {[product.brand, product.size]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  ) : null}

                  <div className="shop-product-price">
                    <strong>
                      {formatCurrency(
                        product.defaultSellPrice,
                      )}
                    </strong>
                    <span>per {product.unit}</span>
                  </div>

                  <div className="shop-product-facts">
                    <span>
                      MOQ {minimumQuantity(product)}
                    </span>
                    <span>
                      {deliveryLabel(
                        product.deliverySlaDays,
                      )}
                    </span>
                  </div>

                  {canRequest ? (
                    <button
                      type="button"
                      className={
                        cartProductIds.has(product.id)
                          ? "button button-secondary"
                          : "button button-primary"
                      }
                      data-ux-silent="true"
                      disabled={cartProductIds.has(product.id)}
                      onClick={() => addToCart(product)}
                    >
                      {cartProductIds.has(product.id) ? (
                        <>
                          <Check size={16} />
                          Added to cart
                        </>
                      ) : (
                        <>
                          <ShoppingBag size={16} />
                          Add to cart
                        </>
                      )}
                    </button>
                  ) : (
                    <span className="button button-secondary">
                      View only
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>

          {!loading && !products.length ? (
            <div className="shop-empty-state">
              <PackageSearch size={40} />
              <strong>No matching products</strong>
              <p>
                Try another search or return to the
                subcategories.
              </p>
            </div>
          ) : null}

          {catalog &&
          catalog.page < catalog.totalPages ? (
            <div className="shop-load-more">
              <span>
                Showing {products.length.toLocaleString()} of{" "}
                {catalog.total.toLocaleString()}
              </span>

              <button
                type="button"
                className="button button-secondary"
                data-ux-silent="true"
                disabled={loadingMore}
                onClick={loadMore}
              >
                {loadingMore ? (
                  <>
                    <LoaderCircle
                      className="catalog-spinner"
                      size={17}
                    />
                    Loading…
                  </>
                ) : (
                  "Load more products"
                )}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
