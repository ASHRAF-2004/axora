import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { listBranches, listCompanies } from "@/lib/repository";
import { createBranchAction, setMasterActiveAction } from "../masters/actions";
import { setBranchBudgetAction } from "./actions";

export default async function BranchesPage() {
  const actor = await requirePagePermission("view_branches");
  const canManageBranches = canAccess(actor, "manage_branches");
  const canManageBudget = canAccess(actor, "manage_branch_budget");
  const [branches, companies] = await Promise.all([listBranches(actor), listCompanies(actor)]);

  return <><PageHeader eyebrow="Company structure" title="Branches & monthly budgets"
    description={actor.isOwner
      ? "Create customer branches during onboarding. Company administrators own their branch budgets and people assignments."
      : "Keep delivery locations clear and control approved purchasing with a monthly budget for each branch."} />

    <section className="panel">
      <div className="panel-header"><div><h2>Branch register</h2><p>{branches.length} branches in your access scope</p></div></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr>
        <th>Branch</th><th>Company</th><th>Delivery</th><th>Monthly budget</th><th>Committed</th><th>Available</th><th>Status</th>{canManageBranches || canManageBudget ? <th>Actions</th> : null}
      </tr></thead><tbody>{branches.map((branch) => <tr key={branch.id}>
        <td><strong>{branch.name}</strong><br /><span className="subtle">{branch.code} · {branch.branchCode}</span></td>
        <td>{branch.companyName}</td><td>{branch.city}<br /><span className="subtle">{branch.deliveryAddress}</span></td>
        <td>{branch.monthlyBudget == null ? <span className="subtle">Not set</span> : formatCurrency(branch.monthlyBudget)}</td>
        <td>{formatCurrency(branch.committedAmount)}</td>
        <td><strong>{branch.remainingAmount == null ? "No limit" : formatCurrency(branch.remainingAmount)}</strong></td>
        <td><StatusBadge>{branch.status}</StatusBadge></td>
        {canManageBranches || canManageBudget ? <td>
          {canManageBudget ? <form action={setBranchBudgetAction} className="stack-sm">
            <input name="branchId" type="hidden" value={branch.id} />
            <input aria-label={`Monthly budget for ${branch.name}`} name="monthlyBudget" type="number" min="0" step="0.01"
              defaultValue={branch.monthlyBudget ?? undefined} placeholder="Monthly budget (RM)" />
            <button className="button button-primary" type="submit">Set budget</button>
          </form> : null}
          {canManageBranches ? <form action={setMasterActiveAction.bind(null, "branches", branch.id, branch.status !== "Active")} style={{ marginTop: 8 }}>
            <button className="button button-secondary" type="submit">{branch.status === "Active" ? "Deactivate" : "Activate"}</button>
          </form> : null}
        </td> : null}
      </tr>)}</tbody></table></div>
    </section>

    {canManageBranches ? <section className="panel form-panel" style={{ marginTop: 17 }}>
      <h2>Create branch</h2><p>Add the delivery location first, then the company administrator can assign its monthly budget and people.</p>
      <form action={createBranchAction}><div className="form-grid">
        <label className="field-full">Company<select name="companyId" required defaultValue={actor.companyId ?? ""}>
          <option value="" disabled>Select company</option>{companies.filter((company) => company.status === "Active").map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}
        </select></label>
        <label className="field-full">Branch name<input name="name" required /></label>
        <label>Branch short code<input name="branchCode" placeholder="KL-HQ" required /></label>
        <label>City / area<input name="city" required /></label>
        <label className="field-full">Delivery address<textarea name="deliveryAddress" required /></label>
        <label>Contact name<input name="contactName" required /></label><label>Contact phone<input name="contactPhone" required /></label>
        <label className="field-full">Contact email<input name="contactEmail" type="email" /></label>
        <label className="field-full">Delivery instructions<textarea name="deliveryInstructions" /></label>
        <label className="field-full">Notes<textarea name="notes" /></label>
      </div><div className="form-actions"><button className="button button-primary" type="submit">Create branch</button></div></form>
    </section> : null}
  </>;
}
