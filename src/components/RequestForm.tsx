"use client";

import type { SessionUser } from "@/lib/auth";
import { formatCurrency, roundMoney } from "@/lib/domain";
import type { Branch, Company, Product } from "@/lib/types";
import { Check, Search, ShoppingCart, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { createRequestAction } from "@/app/(portal)/requests/actions";
import { ProductImage } from "./ProductImage";

interface SelectedLine {
  productId: string;
  quantity: number;
  specification: string;
}

function minimumWholeQuantity(product: Product) {
  return Math.max(Math.ceil(product.minimumOrderQuantity), 1);
}

export function RequestForm({
  actor,
  companies,
  branches,
  products,
  initialProductId,
}: {
  actor: SessionUser;
  companies: Company[];
  branches: Branch[];
  products: Product[];
  initialProductId?: string;
}) {
  const company = companies.find((item) => item.id === actor.companyId) ?? companies[0];
  const activeProducts = useMemo(
    () => products.filter((item) => item.status === "Active"),
    [products],
  );
  const initialProduct = activeProducts.find((item) => item.id === initialProductId);
  const [selected, setSelected] = useState<SelectedLine[]>(
    initialProduct ? [{ productId: initialProduct.id, quantity: minimumWholeQuantity(initialProduct), specification: "" }] : [],
  );
  const [query, setQuery] = useState("");
  const [branchId, setBranchId] = useState(actor.branchId ?? "");

  const availableBranches = branches.filter(
    (item) => item.status === "Active" && item.companyId === company?.id,
  );
  const visibleProducts = activeProducts.filter((product) => {
    const term = query.trim().toLowerCase();
    if (!term) return true;
    return [product.name, product.code, product.category, product.subcategory, product.brand]
      .some((value) => value?.toLowerCase().includes(term));
  });
  const selectedBranch = availableBranches.find((item) => item.id === branchId);
  const estimatedTotal = selected.reduce((total, line) => {
    const product = activeProducts.find((item) => item.id === line.productId);
    return total + roundMoney(line.quantity * (product?.defaultSellPrice ?? 0));
  }, 0);

  function toggleProduct(product: Product) {
    setSelected((current) => current.some((item) => item.productId === product.id)
      ? current.filter((item) => item.productId !== product.id)
      : [...current, {
        productId: product.id,
        quantity: minimumWholeQuantity(product),
        specification: "",
      }]);
  }

  function updateLine(productId: string, patch: Partial<SelectedLine>) {
    setSelected((current) => current.map((item) => item.productId === productId ? { ...item, ...patch } : item));
  }

  return (
    <form action={createRequestAction} className="panel form-panel" style={{ position: "static" }}>
      <input name="companyId" type="hidden" value={company?.id ?? ""} />

      <div className="request-summary" style={{ marginBottom: 20 }}>
        <div className="summary-box"><span>Company</span><strong>{company?.name ?? "Assigned company"}</strong></div>
        <div className="summary-box"><span>Requester</span><strong>{actor.name}</strong><small>{actor.email}</small></div>
        <div className="summary-box"><span>Selected items</span><strong>{selected.length}</strong></div>
        <div className="summary-box"><span>Estimated total</span><strong>{formatCurrency(estimatedTotal)}</strong></div>
      </div>

      <div className="form-grid">
        <label>Branch
          <select name="branchId" required value={branchId} onChange={(event) => setBranchId(event.target.value)}>
            <option value="" disabled>Select branch</option>
            {availableBranches.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
          </select>
        </label>
        <label>Request type<select name="requestType" defaultValue="Standard"><option>Standard</option><option>Ad-hoc</option><option>Recurring</option></select></label>
        <label>Department<input name="department" required placeholder="Administration" /></label>
        <label>Needed by<input name="neededByDate" type="date" required /></label>
        <label>Priority<select name="urgency" defaultValue="Normal"><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
        <label className="field-full">Business justification / notes<textarea name="notes" placeholder="Explain why these items are needed" /></label>
      </div>

      {selectedBranch ? (
        <div className="callout" style={{ marginTop: 16 }}>
          <strong>{selectedBranch.name} budget</strong>
          <p>
            {selectedBranch.monthlyBudget == null
              ? "No monthly limit is configured. The branch approver will still review this request."
              : `${formatCurrency(selectedBranch.remainingAmount ?? 0)} available from ${formatCurrency(selectedBranch.monthlyBudget)} this month. Approval commits the request amount.`}
          </p>
        </div>
      ) : null}

      <div className="panel-header" style={{ marginTop: 24 }}>
        <div><h2>Choose products</h2><p>Search the Axora catalog, then add one or more items.</p></div>
        <div className="toolbar-group">
          <Search aria-hidden="true" size={17} />
          <input aria-label="Search catalog" className="search-input" type="search" value={query}
            onChange={(event) => setQuery(event.target.value)} placeholder="Search product or category" />
        </div>
      </div>

      <div className="metric-grid">
        {visibleProducts.map((product) => {
          const line = selected.find((item) => item.productId === product.id);
          return (
            <article className="panel" key={product.id} style={{ overflow: "hidden" }}>
              <ProductImage product={product} />
              <div className="panel-body">
                <h3 style={{ marginBottom: 4 }}>{product.name}</h3>
                <p className="subtle">{product.code} · {formatCurrency(product.defaultSellPrice)} / {product.unit}</p>
                <button className={line ? "button button-primary" : "button button-secondary"} type="button"
                  onClick={() => toggleProduct(product)} style={{ width: "100%", justifyContent: "center" }}>
                  {line ? <><Check size={16} /> Added</> : <><ShoppingCart size={16} /> Add to request</>}
                </button>
                {line ? (
                  <div className="form-grid" style={{ marginTop: 12 }}>
                    <input name="productId" type="hidden" value={product.id} />
                    <label>Quantity<input name="quantity" type="number" min={minimumWholeQuantity(product)} step="1"
                      value={line.quantity} required onChange={(event) => updateLine(product.id, { quantity: Number(event.target.value) })} /></label>
                    <label>Specification<input name="specification" value={line.specification}
                      onChange={(event) => updateLine(product.id, { specification: event.target.value })}
                      placeholder="Optional size / detail" /></label>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {selected.length ? (
        <div className="panel" style={{ marginTop: 20 }}>
          <div className="panel-body">
            <h2>Request summary</h2>
            {selected.map((line) => {
              const product = activeProducts.find((item) => item.id === line.productId);
              if (!product) return null;
              return <div key={line.productId} className="toolbar" style={{ borderBottom: "1px solid var(--slate-100)" }}>
                <span><strong>{product.name}</strong><br /><small>{line.quantity} × {formatCurrency(product.defaultSellPrice)}</small></span>
                <span><strong>{formatCurrency(roundMoney(line.quantity * product.defaultSellPrice))}</strong>
                  <button type="button" className="icon-button" aria-label={`Remove ${product.name}`} onClick={() => toggleProduct(product)}><Trash2 size={16} /></button>
                </span>
              </div>;
            })}
          </div>
        </div>
      ) : <div className="empty-state"><ShoppingCart size={30} /><strong>No products selected</strong><p>Add at least one catalog item.</p></div>}

      <div className="form-actions">
        <button className="button button-primary" type="submit" disabled={!selected.length || !branchId}>
          Submit for company approval · {formatCurrency(estimatedTotal)}
        </button>
      </div>
    </form>
  );
}
