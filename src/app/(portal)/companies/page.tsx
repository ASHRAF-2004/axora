import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { listCompanies } from "@/lib/repository";
import { COD_PAYMENT_METHOD } from "@/lib/types";
import { createCompanyAction, setMasterActiveAction } from "../masters/actions";

export default async function CompaniesPage() {
  const companies = await listCompanies();
  return <><PageHeader eyebrow="Master data" title="Companies" description="One approved company record connects its branches, requests, invoices and reporting." />
    <section className="split-layout"><article className="panel"><div className="panel-header"><div><h2>Company master</h2><p>{companies.length} company records</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Code</th><th>Company</th><th>Industry</th><th>Main contact</th><th>Payment terms</th><th>Status</th><th>Action</th></tr></thead><tbody>{companies.map((company) => <tr key={company.id}><td><strong>{company.code}</strong></td><td><strong>{company.name}</strong><br /><span className="subtle">{company.billingCycle}</span></td><td>{company.industry}</td><td>{company.mainContactName}<br /><span className="subtle">{company.mainContactEmail}</span></td><td>{company.paymentTerms}</td><td><StatusBadge>{company.status}</StatusBadge></td><td><form action={setMasterActiveAction.bind(null, "companies", company.id, company.status !== "Active")}><button className="button button-secondary" type="submit">{company.status === "Active" ? "Deactivate" : "Activate"}</button></form></td></tr>)}</tbody></table></div></article>
    <form action={createCompanyAction} className="panel form-panel"><h2>Add a company</h2><p>Codes are generated automatically and remain stable.</p><div className="form-grid">
      <label className="field-full">Company name<input name="name" required /></label><label>Industry<input name="industry" required /></label><label>Billing cycle<select name="billingCycle"><option>Monthly</option><option>Per order</option><option>Weekly</option></select></label>
      <label>Main contact<input name="mainContactName" required /></label><label>Main email<input name="mainContactEmail" type="email" required /></label><label>Main phone<input name="mainContactPhone" required /></label><label>Payment terms<input name="paymentTerms" value={COD_PAYMENT_METHOD} readOnly required /></label>
      <label>Billing contact<input name="billingContactName" /></label><label>Billing email<input name="billingContactEmail" type="email" /></label><label>Billing phone<input name="billingContactPhone" /></label><label className="field-full">Billing address<textarea name="billingAddress" required /></label><label className="field-full">Notes<textarea name="notes" /></label>
    </div><div className="form-actions"><button className="button button-primary" type="submit">Add company</button></div></form></section></>;
}
