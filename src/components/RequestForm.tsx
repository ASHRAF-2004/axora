"use client";

import type { Branch, Company, Product } from "@/lib/types";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { createRequestAction } from "@/app/(portal)/requests/actions";

export function RequestForm({ companies, branches, products }: { companies: Company[]; branches: Branch[]; products: Product[] }) {
  const [items, setItems] = useState([0]);
  const [companyId, setCompanyId] = useState("");
  const availableBranches = branches.filter((item) => item.status === "Active" && item.companyId === companyId);
  const productsUseCompanyScope = products.some((item) => Boolean(item.companyId));
  const availableProducts = products.filter((item) => item.status === "Active" && (!productsUseCompanyScope || item.companyId === companyId));
  return (
    <form action={createRequestAction} className="panel form-panel" style={{ position: "static" }}>
      <div className="form-grid">
        <label>Company<select name="companyId" required value={companyId} onChange={(event) => setCompanyId(event.target.value)}><option value="" disabled>Select company</option>{companies.filter((item) => item.status === "Active").map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <label>Branch<select key={companyId} name="branchId" required defaultValue="" disabled={!companyId}><option value="" disabled>{companyId ? "Select branch" : "Choose company first"}</option>{availableBranches.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <label>Request type<select name="requestType" defaultValue="Standard"><option>Standard</option><option>Ad-hoc</option><option>Recurring</option></select></label>
        <label>Department<input name="department" required placeholder="Administration" /></label>
        <label>Requested by<input name="requestedBy" required placeholder="Employee name" /></label>
        <label>Contact number<input name="requesterContact" required placeholder="012-0000000" /></label>
        <label>Needed by<input name="neededByDate" type="date" required /></label>
        <label>Urgency<select name="urgency" defaultValue="Normal"><option>Low</option><option>Normal</option><option>High</option><option>Urgent</option></select></label>
        <label className="field-full">Request notes<textarea name="notes" placeholder="Context, delivery instructions or special conditions" /></label>
      </div>
      <h2 className="section-title">Requested items</h2>
      <div className="line-builder">{items.map((key, index) => (
        <div className="line-card" key={`${companyId}-${key}`}>
          <label>Product<select name="productId" required defaultValue="" disabled={!companyId}><option value="" disabled>{companyId ? "Select product" : "Choose company first"}</option>{availableProducts.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
          <label>Quantity<input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" required /></label>
          <label>Specification<input name="specification" placeholder="Optional size / brand" /></label>
          <button type="button" className="remove-line" aria-label={`Remove item ${index + 1}`} disabled={items.length === 1} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 size={17} /></button>
        </div>
      ))}</div>
      <div className="form-actions" style={{ justifyContent: "space-between" }}><button className="button button-secondary" type="button" onClick={() => setItems((current) => [...current, Math.max(...current) + 1])}><Plus size={16} />Add another item</button><button className="button button-primary" type="submit">Create request</button></div>
    </form>
  );
}
