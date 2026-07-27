import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { listSuppliers } from "@/lib/repository";
import { COD_PAYMENT_METHOD } from "@/lib/types";
import { createSupplierAction, setMasterActiveAction } from "../masters/actions";

export default async function SuppliersPage() {
  const actor = await requirePagePermission("manage_suppliers");
  const suppliers = await listSuppliers(actor);
  return <><PageHeader eyebrow="Platform owner · Internal sourcing" title="Suppliers" description="Maintain Axora's global supplier register. Supplier contacts and buying terms are never exposed to company customer roles." />
    <section className="split-layout"><article className="panel"><div className="panel-header"><div><h2>Global supplier register</h2><p>{suppliers.length} supplier records</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Code</th><th>Supplier</th><th>Category</th><th>Coverage</th><th>Lead time</th><th>Status</th><th>Action</th></tr></thead><tbody>{suppliers.map((supplier) => <tr key={supplier.id}><td><strong>{supplier.code}</strong></td><td><strong>{supplier.name}</strong><br /><span className="subtle">{supplier.contactName} · {supplier.email}</span></td><td>{supplier.category}</td><td>{supplier.coverageArea}</td><td>{supplier.leadTimeDays} day{supplier.leadTimeDays === 1 ? "" : "s"}<br /><span className="subtle">{supplier.paymentTerms}</span></td><td><StatusBadge>{supplier.status}</StatusBadge></td><td><form action={setMasterActiveAction.bind(null, "suppliers", supplier.id, supplier.status !== "Active")}><button className="button button-secondary" type="submit">{supplier.status === "Active" ? "Deactivate" : "Activate"}</button></form></td></tr>)}</tbody></table></div></article>
    <form action={createSupplierAction} className="panel form-panel"><h2>Add global supplier</h2><p>Search first. Deactivate old records instead of creating duplicates.</p><div className="form-grid">
      <label className="field-full">Supplier name<input name="name" required /></label><label>Category<input name="category" required /></label><label>Coverage area<input name="coverageArea" required /></label><label>Contact name<input name="contactName" required /></label><label>Phone / WhatsApp<input name="phone" required /></label><label className="field-full">Email<input name="email" type="email" /></label><label className="field-full">Address<textarea name="address" required /></label>
      <label>Payment terms<input name="paymentTerms" value={COD_PAYMENT_METHOD} readOnly required /></label><label>Lead time (days)<input name="leadTimeDays" type="number" min="0" defaultValue="1" /></label><label>Minimum quantity<input name="minimumOrderQuantity" type="number" min="0.01" step="0.01" defaultValue="1" /></label><label>Main products<input name="mainProducts" required /></label><label className="field-full">Notes<textarea name="notes" /></label>
    </div><div className="form-actions"><button className="button button-primary" type="submit">Add supplier</button></div></form></section></>;
}
