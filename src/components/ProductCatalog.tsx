"use client";

import { formatCurrency } from "@/lib/domain";
import type { Product } from "@/lib/types";
import { ArrowRight, PackageSearch, Search, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ProductImage } from "./ProductImage";

function productDescription(product: Product) {
  return product.description
    || [product.brand, product.size, product.packaging].filter(Boolean).join(" · ")
    || product.subcategory
    || "Available from the approved Axora product catalogue.";
}

function deliveryLabel(days: number) {
  if (days === 0) return "Same day";
  return `${days} day${days === 1 ? "" : "s"}`;
}

function quantityLabel(quantity: number) {
  return new Intl.NumberFormat("en-MY", { maximumFractionDigits: 3 }).format(quantity);
}

export function ProductCatalog({
  products,
  canRequest = true,
  initialCategory = "all",
  initialQuery = "",
}: {
  products: Product[];
  canRequest?: boolean;
  initialCategory?: string;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [category, setCategory] = useState(initialCategory);

  const activeProducts = useMemo(
    () => products.filter((product) => product.status === "Active"),
    [products],
  );

  const categories = useMemo(
    () => [...new Set(activeProducts.map((product) => product.category))].sort((a, b) => a.localeCompare(b)),
    [activeProducts],
  );

  const visibleProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return activeProducts
      .filter((product) => category === "all" || product.category === category)
      .filter((product) => {
        if (!normalizedQuery) return true;
        return [
          product.name,
          product.code,
          product.category,
          product.subcategory,
          product.brand,
          product.size,
          product.packaging,
          product.description,
          product.unit,
        ].some((value) => value?.toLowerCase().includes(normalizedQuery));
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [activeProducts, category, query]);

  const hasFilters = query.trim().length > 0 || category !== "all";

  return (
    <section aria-label="Product catalogue">
      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        <div className="toolbar-group" style={{ flex: "1 1 320px" }}>
          <Search aria-hidden="true" className="muted" size={18} />
          <input
            aria-label="Search products"
            className="search-input"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search product, code, category or brand"
            style={{ minWidth: 0, width: "100%" }}
            type="search"
            value={query}
          />
        </div>

        <div className="toolbar-group" style={{ flexWrap: "wrap" }}>
          <SlidersHorizontal aria-hidden="true" className="muted" size={17} />
          <select
            aria-label="Filter products by category"
            onChange={(event) => setCategory(event.target.value)}
            value={category}
          >
            <option value="all">All categories</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <span className="subtle" aria-live="polite">
            {visibleProducts.length} product{visibleProducts.length === 1 ? "" : "s"}
          </span>
          {hasFilters ? (
            <button
              className="button button-secondary"
              onClick={() => {
                setQuery("");
                setCategory("all");
              }}
              type="button"
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      {visibleProducts.length ? (
        <div className="metric-grid">
          {visibleProducts.map((product) => {
            const card = <>
              <ProductImage product={product} />

              <div className="panel-body" style={{ display: "flex", flex: 1, flexDirection: "column" }}>
                <h2
                  style={{
                    color: "var(--navy-900)",
                    fontSize: 18,
                    letterSpacing: "-.025em",
                    lineHeight: 1.25,
                    margin: "0 0 6px",
                  }}
                >
                  {product.name}
                </h2>
                <p className="subtle" style={{ margin: "0 0 14px" }}>
                  {product.code} · {product.category}
                </p>
                <p
                  style={{
                    color: "var(--slate-600)",
                    display: "-webkit-box",
                    fontSize: 12,
                    lineHeight: 1.55,
                    margin: "0 0 17px",
                    minHeight: "3.1em",
                    overflow: "hidden",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: 2,
                  }}
                >
                  {productDescription(product)}
                </p>

                <div className="request-summary" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  <div className="summary-box" style={{ padding: 10 }}>
                    <span>Unit</span>
                    <strong style={{ fontSize: 12 }}>{product.unit}</strong>
                  </div>
                  <div className="summary-box" style={{ padding: 10 }}>
                    <span>MOQ</span>
                    <strong style={{ fontSize: 12 }}>{quantityLabel(product.minimumOrderQuantity)}</strong>
                  </div>
                  <div className="summary-box" style={{ padding: 10 }}>
                    <span>SLA</span>
                    <strong style={{ fontSize: 12 }}>{deliveryLabel(product.deliverySlaDays)}</strong>
                  </div>
                </div>

                <div
                  style={{
                    alignItems: "end",
                    borderTop: "1px solid var(--slate-100)",
                    display: "flex",
                    justifyContent: "space-between",
                    marginTop: "auto",
                    paddingTop: 18,
                  }}
                >
                  <div>
                    <span className="metric-label">Catalog price</span>
                    <div className="metric-value" style={{ fontSize: 22, marginBottom: 0 }}>
                      {formatCurrency(product.defaultSellPrice)}
                    </div>
                    <span className="subtle">per {product.unit.toLowerCase()}</span>
                  </div>
                  <span className={canRequest ? "button button-primary" : "button button-secondary"} style={{ padding: "0 13px" }}>
                    {canRequest ? <><span>Request</span><ArrowRight aria-hidden="true" size={16} /></> : "View only"}
                  </span>
                </div>
              </div>
            </>;
            const style = {
              display: "flex",
              flexDirection: "column" as const,
              minHeight: 470,
              transition: "transform .18s ease, box-shadow .18s ease",
            };
            return canRequest ? (
              <Link
                aria-label={`Request ${product.name}`}
                className="panel"
                href={`/requests/new?product=${encodeURIComponent(product.id)}`}
                key={product.id}
                style={style}
              >
                {card}
              </Link>
            ) : (
              <article className="panel" key={product.id} style={style}>{card}</article>
            );
          })}
        </div>
      ) : (
        <div className="panel empty-state">
          <PackageSearch aria-hidden="true" size={34} style={{ marginBottom: 12 }} />
          <strong>No products found</strong>
          <p style={{ margin: 0 }}>Try another search or clear the category filter.</p>
          {hasFilters ? (
            <button
              className="button button-secondary"
              onClick={() => {
                setQuery("");
                setCategory("all");
              }}
              style={{ marginTop: 16 }}
              type="button"
            >
              Clear filters
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
