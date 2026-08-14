import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency } from "@/lib/domain";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import { canAccess } from "@/lib/permissions";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import { organizationStructureMessages } from "@/lib/organization-structure-i18n";
import Link from "next/link";

export default async function BranchesPage() {
  const actor = await requirePagePermission("view_branches");
  const locale = actor.preferredLocale ?? "en";
  const copy = corePortalMessages(locale).branches;
  const common = corePortalMessages(locale).common;
  const structureCopy = organizationStructureMessages(locale);
  const openBranch = { en: "Open branch", ar: "فتح الفرع", ms: "Buka cawangan" }[locale];
  const canManageBranches = canAccess(actor, "manage_branches");
  const platformView = actor.isOwner || actor.accountKind === "PLATFORM";
  const { branches } = await loadOrganizationDirectory(actor);
  const showBudgetColumns = !platformView && branches.some((branch) => branch.canViewBudget);

  return <><PageHeader eyebrow={copy.eyebrow} title={copy.title}
    description={platformView ? copy.platformDescription : copy.companyDescription} />

    <section className="panel"><div className="panel-header"><div><h2>{structureCopy.title}</h2><p>{structureCopy.description}</p></div><Link className="button button-primary" href="/branches/organization">{structureCopy.open}</Link></div></section>

    <section className="panel" style={{ marginBlockStart: 17 }}>
      <div className="panel-header"><div><h2>{copy.register}</h2><p>{copy.count(branches.length)}</p></div>{canManageBranches ? <Link className="button button-primary" href="/branches/new">{copy.create}</Link> : null}</div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr>
        <th>{common.branch}</th><th>{common.company}</th><th>{copy.delivery}</th>{showBudgetColumns ? <><th>{copy.monthlyBudget}</th><th>{copy.committed}</th><th>{copy.available}</th></> : null}<th>{common.status}</th><th>{common.actions}</th>
      </tr></thead><tbody>{branches.map((branch) => <tr key={branch.id}>
        <td><strong>{branch.name}</strong><br /><span className="subtle">{branch.code} · {branch.branchCode}</span></td>
        <td>{branch.companyName}</td><td>{branch.city}<br /><span className="subtle">{branch.deliveryAddress}</span></td>
        {showBudgetColumns ? branch.canViewBudget ? <>
          <td>{branch.monthlyBudget == null ? <span className="subtle">{common.notSet}</span> : formatCurrency(branch.monthlyBudget, locale)}</td>
          <td>{formatCurrency(branch.committedAmount ?? 0, locale)}</td>
          <td><strong>{branch.remainingAmount == null ? common.noLimit : formatCurrency(branch.remainingAmount, locale)}</strong></td>
        </> : <><td aria-label={common.notSet}>—</td><td aria-label={common.notSet}>—</td><td aria-label={common.notSet}>—</td></> : null}
        <td><StatusBadge status={branch.status}>{localizedStatus(branch.status, locale)}</StatusBadge></td>
        <td><Link className="button button-secondary" href={`/branches/${branch.id}`}>{openBranch}</Link></td>
      </tr>)}</tbody></table></div>
    </section>

  </>;
}
