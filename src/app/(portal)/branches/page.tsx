import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import { canAccess } from "@/lib/permissions";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import Link from "next/link";

export default async function BranchesPage() {
  const actor = await requirePagePermission("view_branches");
  const locale = actor.preferredLocale ?? "en";
  const copy = corePortalMessages(locale).branches;
  const common = corePortalMessages(locale).common;
  const openBranch = { en: "Open branch", ar: "فتح الفرع", ms: "Buka cawangan" }[locale];
  const canManageBranches = canAccess(actor, "manage_branches");
  const platformView = actor.isOwner || actor.accountKind === "PLATFORM";
  const { branches } = await loadOrganizationDirectory(actor);

  return <><PageHeader eyebrow={copy.eyebrow} title={copy.title}
    description={platformView ? copy.platformDescription : copy.companyDescription} />

    <section className="panel">
      <div className="panel-header"><div><h2>{copy.register}</h2><p>{copy.count(branches.length)}</p></div>{canManageBranches ? <Link className="button button-primary" href="/branches/new">{copy.create}</Link> : null}</div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr>
        <th>{common.branch}</th>{platformView ? <th>{common.company}</th> : null}<th>{copy.delivery}</th><th>{common.status}</th><th>{common.actions}</th>
      </tr></thead><tbody>{branches.map((branch) => <tr key={branch.id}>
        <td><strong>{branch.name}</strong><br /><span className="subtle">{branch.code} · {branch.branchCode}</span></td>
        {platformView ? <td>{branch.companyName}</td> : null}<td>{branch.city}<br /><span className="subtle">{branch.deliveryAddress}</span></td>
        <td><StatusBadge status={branch.status}>{localizedStatus(branch.status, locale)}</StatusBadge></td>
        <td><Link className="button button-secondary" href={`/branches/${branch.id}`}>{openBranch}</Link></td>
      </tr>)}</tbody></table></div>
    </section>

  </>;
}
