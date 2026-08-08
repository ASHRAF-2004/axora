"use client";

import type {
  CatalogSearchResult,
  CatalogSort,
  ShopCategorySummary,
} from "@/lib/catalog";
import { formatCurrency, roundMoney } from "@/lib/domain";
import type { SupportedLocale } from "@/lib/i18n";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import { shopMessages } from "@/lib/shop-i18n";
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
import { productQuantityRule } from "@/lib/procurement-rules";
import { procurementRulesMessages } from "@/lib/procurement-rules-i18n";

export function ShopCategoryHub({
  departments,
  canRequest,
  locale = "en",
}: {
  departments: ShopCategorySummary[];
  canRequest: boolean;
  locale?: SupportedLocale;
}) {
  const productCopy = corePortalMessages(locale).products;
  const shopCopy = shopMessages(locale);
  const ruleCopy = procurementRulesMessages(locale);
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
            : shopCopy.loadError,
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
    [buildParams, shopCopy.loadError],
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
              : shopCopy.loadError,
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
  }, [loadProducts, shopCopy.loadError, showingProducts]);

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
          : shopCopy.loadMoreError,
      );
    } finally {
      setLoadingMore(false);
    }
  }

  const pageTitle = useMemo(() => {
    if (query) {
      return selectedCategory
        ? shopCopy.searchIn(selectedCategory.name)
        : shopCopy.searchResults;
    }

    if (selectedSubcategory) return selectedSubcategory;
    if (viewAllCategory) return shopCopy.allIn(selectedCategory?.name ?? "");

    return "";
  }, [
    query,
    selectedCategory,
    selectedSubcategory,
    shopCopy,
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
        ? shopCopy.addedNotice(product.name)
        : shopCopy.duplicateNotice(product.name),
      result.added ? "success" : "info",
    );
  }

  return (
    <section className="shop-hub" aria-label={shopCopy.aria}>
      <div className="shop-search-hero">
        <div className="shop-search-copy">
          <span>{productCopy.shopEyebrow}</span>
          <h2>{shopCopy.heading}</h2>
          <p>{shopCopy.intro}</p>
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
                ? shopCopy.searchInside(selectedCategory.name)
                : shopCopy.searchPlaceholder
            }
            aria-label={shopCopy.searchAria}
          />

          {searchText ? (
            <button
              type="button"
              aria-label={shopCopy.clearSearch}
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
          aria-label={shopCopy.cartAria}
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
                ? shopCopy.cartItems(cartItems.length)
                : shopCopy.emptyCart}
            </strong>
            <span>
              {cartItems.length
                ? shopCopy.cartSummary(cartQuantity, formatCurrency(cartSubtotal, locale))
                : shopCopy.emptyCartBody}
            </span>
          </div>

          <Link
            href="/requests/new?cart=1"
            className="button button-primary"
            aria-disabled={!cartItems.length}
            tabIndex={cartItems.length ? undefined : -1}
          >
            {shopCopy.review}
            <ArrowRight className="directional-icon" size={16} aria-hidden="true" />
          </Link>
        </aside>
      ) : null}

      {selectedCategory ? (
        <nav className="shop-breadcrumb" aria-label={shopCopy.breadcrumb}>
          <button
            type="button"
            data-ux-silent="true"
            onClick={returnToDepartments}
          >
            {shopCopy.shop}
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
              <span>{shopCopy.browse}</span>
              <h2>{shopCopy.byCategory}</h2>
              <p>{shopCopy.chooseDepartment}</p>
            </div>

            <strong>
              {departments.length}{" "}
              {departments.length === 1
                ? shopCopy.department
                : shopCopy.departments}
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
                    locale={locale}
                  />

                  <span className="shop-department-count">
                    {department.count}{" "}
                    {department.count === 1
                      ? shopCopy.product
                      : shopCopy.products}
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
                    {shopCopy.browseDepartment}
                    <ArrowRight className="directional-icon" size={17} aria-hidden="true" />
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
              <ArrowLeft className="directional-icon" size={17} />
              {shopCopy.allDepartments}
            </button>

            <div>
              <span>{shopCopy.departmentLabel}</span>
              <h2>{selectedCategory.name}</h2>
              <p>{shopCopy.chooseOrView}</p>
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
              {shopCopy.viewAll(selectedCategory.count)}
            </button>
          </div>

          <div className="shop-section-heading">
            <div>
              <span>{selectedCategory.name}</span>
              <h2>{shopCopy.chooseSubcategory}</h2>
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
                      locale={locale}
                    />
                  </div>

                  <div>
                    <h3>{subcategory.name}</h3>
                    <span>
                      {subcategory.count}{" "}
                      {subcategory.count === 1
                        ? shopCopy.product
                        : shopCopy.products}
                    </span>
                  </div>

                  <ChevronRight className="directional-icon" size={19} aria-hidden="true" />
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
                <ArrowLeft className="directional-icon" size={16} />
                {shopCopy.back}
              </button>

              <h2>{pageTitle}</h2>

              <span aria-live="polite">
                {catalog
                  ? shopCopy.found(catalog.total)
                  : shopCopy.loadingProducts}
              </span>
            </div>

            <label>
              {shopCopy.sortBy}
              <select
                value={sort}
                onChange={(event) =>
                  setSort(
                    event.target.value as CatalogSort,
                  )
                }
              >
                <option value="relevance">{shopCopy.recommended}</option>
                <option value="name-asc">{shopCopy.nameAsc}</option>
                <option value="price-asc">
                  {shopCopy.priceAsc}
                </option>
                <option value="price-desc">
                  {shopCopy.priceDesc}
                </option>
                <option value="delivery-asc">
                  {shopCopy.fastest}
                </option>
                <option value="moq-asc">{shopCopy.lowestMoq}</option>
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
                  <ProductImage product={product} locale={locale} />
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
                          product.defaultSellPrice, locale,
                        )}
                    </strong>
                    <span>{shopCopy.per} {product.packSize && product.packSize > 1 ? product.packUnit : product.unit}</span>
                  </div>

                  {product.packSize && product.packSize > 1 ? (
                    <small>{ruleCopy.packSummary(product.packSize, product.packUnit ?? product.unit)}</small>
                  ) : null}

                  <div className="shop-product-facts">
                    <span>
                      {ruleCopy.quantitySummary(productQuantityRule(product))}
                    </span>
                    <span>
                      {product.deliverySlaDays === 0 ? shopCopy.sameDay : shopCopy.days(product.deliverySlaDays)}
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
                          {shopCopy.added}
                        </>
                      ) : (
                        <>
                          <ShoppingBag size={16} />
                          {shopCopy.add}
                        </>
                      )}
                    </button>
                  ) : (
                    <span className="button button-secondary">
                      {shopCopy.viewOnly}
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>

          {!loading && !products.length ? (
            <div className="shop-empty-state">
              <PackageSearch size={40} />
              <strong>{shopCopy.noMatch}</strong>
              <p>{shopCopy.noMatchBody}</p>
            </div>
          ) : null}

          {catalog &&
          catalog.page < catalog.totalPages ? (
            <div className="shop-load-more">
              <span>
                {shopCopy.showing(products.length, catalog.total)}
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
                    {shopCopy.loading}
                  </>
                ) : (
                  shopCopy.loadMore
                )}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
