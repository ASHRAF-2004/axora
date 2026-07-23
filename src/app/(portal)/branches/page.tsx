import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requireSession } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { listBranches, listCompanies } from "@/lib/repository";
import { createBranchAction, setMasterActiveAction } from "../masters/actions";

export default async function BranchesPage() {
  const actor = await requireSession();
  const canManage = hasPermission(actor.role, "manage_masters");
  const [branches, companies] = await Promise.all([listBranches(actor), listCompanies(actor)]);
  return <><PageHeader eyebrow="Master data" title="Branches" description="Every branch belongs to one company and carries its own delivery address and contact instructions." />
    <section className="split-layout"><article className="panel"><div className="panel-header"><div><h2>Branch master</h2><p>{branches.length} branch records</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Code</th><th>Branch</th><th>Company</th><th>Area</th><th>Contact</th><th>Status</th>{canManage ? <th>Action</th> : null}</tr></thead><tbody>{branches.map((branch) => <tr key={branch.id}><td><strong>{branch.code}</strong><br /><span className="subtle">{branch.branchCode}</span></td><td><strong>{branch.name}</strong><br /><span className="subtle">{branch.deliveryAddress}</span></td><td>{branch.companyName}</td><td>{branch.city}</td><td>{branch.contactName}<br /><span className="subtle">{branch.contactPhone}</span></td><td><StatusBadge>{branch.status}</StatusBadge></td>{canManage ? <td><form action={setMasterActiveAction.bind(null, "branches", branch.id, branch.status !== "Active")}><button className="button button-secondary" type="submit">{branch.status === "Active" ? "Deactivate" : "Activate"}</button></form></td> : null}</tr>)}</tbody></table></div></article>
    {canManage ? <form action={createBranchAction} className="panel form-panel"><h2>Add a branch</h2><p>Choose the parent company instead of typing it again.</p><div className="form-grid">
      <label className="field-full">Company<select name="companyId" required defaultValue=""><option value="" disabled>Select company</option>{companies.filter((company) => company.status === "Active").map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}</select></label>
      <label className="field-full">Branch name<input name="name" required /></label><label>Branch short code<input name="branchCode" placeholder="EX-HQ" required /></label><label>City / area<input name="city" required /></label><label className="field-full">Delivery address<textarea name="deliveryAddress" required /></label>
      <label>Contact name<input name="contactName" required /></label><label>Contact phone<input name="contactPhone" required /></label><label className="field-full">Contact email<input name="contactEmail" type="email" /></label><label className="field-full">Delivery instructions<textarea name="deliveryInstructions" /></label><label className="field-full">Notes<textarea name="notes" /></label>
    </div><div className="form-actions"><button className="button button-primary" type="submit">Add branch</button></div></form> : null}</section></>;
}
