import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency } from "@/lib/domain";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import { canAccess } from "@/lib/permissions";
import { createBranchAction, setMasterActiveAction } from "../masters/actions";
import { setBranchBudgetAction } from "./actions";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import { organizationStructureMessages } from "@/lib/organization-structure-i18n";
import Link from "next/link";

export default async function BranchesPage() {
  const actor = await requirePagePermission("view_branches");
  const locale = actor.preferredLocale ?? "en";
  const copy = corePortalMessages(locale).branches;
  const common = corePortalMessages(locale).common;
  const structureCopy = organizationStructureMessages(locale);
  const canManageBranches = canAccess(actor, "manage_branches");
  const canManageBudget = canAccess(actor, "manage_branch_budget");
  const platformView = actor.isOwner || actor.accountKind === "PLATFORM";
  const { branches, companies } = await loadOrganizationDirectory(actor);
  const showBudgetColumns = branches.some((branch) => branch.canViewBudget);
  const showActions = canManageBranches || canManageBudget;

  return <><PageHeader eyebrow={copy.eyebrow} title={copy.title}
    description={platformView ? copy.platformDescription : copy.companyDescription} />

    <section className="panel"><div className="panel-header"><div><h2>{structureCopy.title}</h2><p>{structureCopy.description}</p></div><Link className="button button-primary" href="/branches/organization">{structureCopy.open}</Link></div></section>

    <section className="panel" style={{ marginBlockStart: 17 }}>
      <div className="panel-header"><div><h2>{copy.register}</h2><p>{copy.count(branches.length)}</p></div></div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr>
        <th>{common.branch}</th><th>{common.company}</th><th>{copy.delivery}</th>{showBudgetColumns ? <><th>{copy.monthlyBudget}</th><th>{copy.committed}</th><th>{copy.available}</th></> : null}<th>{common.status}</th>{showActions ? <th>{common.actions}</th> : null}
      </tr></thead><tbody>{branches.map((branch) => <tr key={branch.id}>
        <td><strong>{branch.name}</strong><br /><span className="subtle">{branch.code} · {branch.branchCode}</span></td>
        <td>{branch.companyName}</td><td>{branch.city}<br /><span className="subtle">{branch.deliveryAddress}</span></td>
        {showBudgetColumns ? branch.canViewBudget ? <>
          <td>{branch.monthlyBudget == null ? <span className="subtle">{common.notSet}</span> : formatCurrency(branch.monthlyBudget, locale)}</td>
          <td>{formatCurrency(branch.committedAmount ?? 0, locale)}</td>
          <td><strong>{branch.remainingAmount == null ? common.noLimit : formatCurrency(branch.remainingAmount, locale)}</strong></td>
        </> : <><td aria-label={common.notSet}>—</td><td aria-label={common.notSet}>—</td><td aria-label={common.notSet}>—</td></> : null}
        <td><StatusBadge status={branch.status}>{localizedStatus(branch.status, locale)}</StatusBadge></td>
        {showActions ? <td>
          {canManageBudget && branch.canViewBudget ? <form action={setBranchBudgetAction} className="stack-sm">
            <input name="branchId" type="hidden" value={branch.id} />
            <input aria-label={copy.budgetFor(branch.name)} name="monthlyBudget" type="number" min="0" step="0.01"
              defaultValue={branch.monthlyBudget ?? undefined} placeholder={copy.budgetPlaceholder} />
            <button className="button button-primary" type="submit">{copy.setBudget}</button>
          </form> : null}
          {canManageBranches ? <form action={setMasterActiveAction.bind(null, "branches", branch.id, branch.status !== "Active")} style={{ marginBlockStart: 8 }}>
            <button className="button button-secondary" type="submit">{branch.status === "Active" ? common.deactivate : common.activate}</button>
          </form> : null}
        </td> : null}
      </tr>)}</tbody></table></div>
    </section>

    {canManageBranches ? <section className="panel form-panel" style={{ marginBlockStart: 17 }}>
      <h2>{copy.createTitle}</h2><p>{copy.createBody}</p>
      <form action={createBranchAction}><div className="form-grid">
        <label className="field-full">Company<select name="companyId" required defaultValue={actor.companyId ?? ""}>
          <option value="" disabled>{copy.selectCompany}</option>{companies.filter((company) => company.status === "Active").map((company) => <option key={company.id} value={company.id}>{company.code} · {company.name}</option>)}
        </select></label>
        <label className="field-full">{copy.branchName}<input name="name" required /></label>
        <label>{copy.shortCode}<input name="branchCode" placeholder="KL-HQ" required /></label>
        <label>{copy.city}<input name="city" required /></label>
        <label className="field-full">{copy.address}<textarea name="deliveryAddress" required /></label>
        <label>{copy.contactName}<input name="contactName" required /></label><label>{copy.contactPhone}<input name="contactPhone" required /></label>
        <label className="field-full">{copy.contactEmail}<input name="contactEmail" type="email" /></label>
        <label className="field-full">{copy.instructions}<textarea name="deliveryInstructions" /></label>
        <label className="field-full">{copy.notes}<textarea name="notes" /></label>
      </div><div className="form-actions"><button className="button button-primary" type="submit">{copy.create}</button></div></form>
    </section> : null}
  </>;
}
