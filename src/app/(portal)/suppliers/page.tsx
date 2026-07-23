import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listCompanies, listSuppliers } from "@/lib/repository";
import { COD_PAYMENT_METHOD } from "@/lib/types";
import { createSupplierAction, setMasterActiveAction } from "../masters/actions";

export default async function SuppliersPage() {
  const actor = await requireSession();
  const canManage = hasPermission(actor.role, "manage_masters");
  const [suppliers, companies] = await Promise.all([listSuppliers(actor), actor.isOwner ? listCompanies(actor) : Promise.resolve([])]);
  return <><PageHeader eyebrow="Master data" title="Suppliers" description="Store approved supplier contacts, coverage, lead time, payment terms and product capability once." />
    <section className="split-layout"><article className="panel"><div className="panel-header"><div><h2>Supplier master</h2><p>{suppliers.length} supplier records</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Code</th><th>Supplier</th>{actor.isOwner ? <th>Company</th> : null}<th>Category</th><th>Coverage</th><th>Lead time</th><th>Status</th>{canManage ? <th>Action</th> : null}</tr></thead><tbody>{suppliers.map((supplier) => <tr key={supplier.id}><td><strong>{supplier.code}</strong></td><td><strong>{supplier.name}</strong><br /><span className="subtle">{supplier.contactName} · {supplier.email}</span></td>{actor.isOwner ? <td>{supplier.companyName || "Legacy / unassigned"}</td> : null}<td>{supplier.category}</td><td>{supplier.coverageArea}</td><td>{supplier.leadTimeDays} day{supplier.leadTimeDays === 1 ? "" : "s"}<br /><span className="subtle">{supplier.paymentTerms}</span></td><td><StatusBadge>{supplier.status}</StatusBadge></td>{canManage ? <td><form action={setMasterActiveAction.bind(null, "suppliers", supplier.id, supplier.status !== "Active")}><button className="button button-secondary" type="submit">{supplier.status === "Active" ? "Deactivate" : "Activate"}</button></form></td> : null}</tr>)}</tbody></table></div></article>
    {canManage ? <form action={createSupplierAction} className="panel form-panel"><h2>Add a supplier</h2><p>Do not create a duplicate when the supplier already exists.</p><div className="form-grid">
      {actor.isOwner ? <label className="field-full">Company<select name="companyId" required defaultValue=""><option value="" disabled>Select company</option>{companies.filter((company) => company.status === "Active").map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}</select></label> : null}
      <label className="field-full">Supplier name<input name="name" required /></label><label>Category<input name="category" required /></label><label>Coverage area<input name="coverageArea" required /></label><label>Contact name<input name="contactName" required /></label><label>Phone / WhatsApp<input name="phone" required /></label><label className="field-full">Email<input name="email" type="email" /></label><label className="field-full">Address<textarea name="address" required /></label>
      <label>Payment terms<input name="paymentTerms" value={COD_PAYMENT_METHOD} readOnly required /></label><label>Lead time (days)<input name="leadTimeDays" type="number" min="0" defaultValue="1" /></label><label>Minimum quantity<input name="minimumOrderQuantity" type="number" min="0.01" step="0.01" defaultValue="1" /></label><label>Main products<input name="mainProducts" required /></label><label className="field-full">Notes<textarea name="notes" /></label>
    </div><div className="form-actions"><button className="button button-primary" type="submit">Add supplier</button></div></form> : null}</section></>;
}
