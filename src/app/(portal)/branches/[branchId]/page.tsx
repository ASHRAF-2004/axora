import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { loadBranchDeliveryLocationWorkspace } from "@/lib/branch-delivery-location";
import { corePortalMessages,localizedStatus } from "@/lib/core-portal-i18n";
import { formatCurrency } from "@/lib/domain";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import { canAccess } from "@/lib/permissions";
import { setMasterActiveAction } from "../../masters/actions";
import { setBranchBudgetAction } from "../actions";

const localCopy = {
  en: { back: "Back to branches",details: "Branch details",budget: "Budget controls",deliveryLocation: "Delivery location" },
  ar: { back: "العودة إلى الفروع",details: "تفاصيل الفرع",budget: "ضوابط الميزانية",deliveryLocation: "موقع التسليم" },
  ms: { back: "Kembali ke cawangan",details: "Butiran cawangan",budget: "Kawalan bajet",deliveryLocation: "Lokasi penghantaran" },
} as const;

export default async function BranchDetailPage({ params }: { params: Promise<{ branchId: string }> }) {
  const actor = await requirePagePermission("view_branches");
  const locale = actor.preferredLocale ?? "en";
  const copy = corePortalMessages(locale).branches;
  const common = corePortalMessages(locale).common;
  const local = localCopy[locale];
  const { branchId } = await params;
  const { branches } = await loadOrganizationDirectory(actor);
  const branch = branches.find((item) => item.id === branchId);
  if (!branch) notFound();
  const locationWorkspace = await loadBranchDeliveryLocationWorkspace(actor, branch.id)
    .catch(() => null);
  const canOpenDeliveryLocation = Boolean(locationWorkspace
    && (locationWorkspace.canManage || actor.accountKind === "PLATFORM"));
  const canManageBranches = canAccess(actor,"manage_branches");
  const canManageBudget = actor.accountKind === "COMPANY"
    && canAccess(actor,"manage_branch_budget")
    && branch.canViewBudget;

  return <>
    <PageHeader eyebrow={copy.eyebrow} title={branch.name} description={`${branch.companyName} · ${branch.city}`} />
    <div className="page-actions"><Link className="button button-secondary" href="/branches">{local.back}</Link>
      {canOpenDeliveryLocation ? <Link className="button button-primary" href={`/branches/${branch.id}/delivery-location`}>{local.deliveryLocation}</Link> : null}
    </div>
    <section className="detail-grid">
      <article className="panel"><h2>{local.details}</h2><dl className="summary-list">
        <div><dt>{common.company}</dt><dd>{branch.companyName}</dd></div>
        <div><dt>{copy.shortCode}</dt><dd>{branch.branchCode}</dd></div>
        <div><dt>{copy.delivery}</dt><dd>{branch.deliveryAddress}</dd></div>
        <div><dt>{common.status}</dt><dd><StatusBadge status={branch.status}>{localizedStatus(branch.status,locale)}</StatusBadge></dd></div>
      </dl></article>
      {branch.canViewBudget ? <article className="panel"><h2>{local.budget}</h2><dl className="summary-list">
        <div><dt>{copy.monthlyBudget}</dt><dd>{branch.monthlyBudget == null ? common.notSet : formatCurrency(branch.monthlyBudget,locale)}</dd></div>
        <div><dt>{copy.committed}</dt><dd>{formatCurrency(branch.committedAmount ?? 0,locale)}</dd></div>
        <div><dt>{copy.available}</dt><dd>{branch.remainingAmount == null ? common.noLimit : formatCurrency(branch.remainingAmount,locale)}</dd></div>
      </dl></article> : null}
    </section>
    {canManageBudget || canManageBranches ? <section className="panel"><h2>{common.actions}</h2><div className="detail-grid">
      {canManageBudget ? <form action={setBranchBudgetAction} className="stack-sm">
        <input name="branchId" type="hidden" value={branch.id} />
        <label>{copy.budgetFor(branch.name)}<input name="monthlyBudget" type="number" min="0" step="0.01" defaultValue={branch.monthlyBudget ?? undefined} placeholder={copy.budgetPlaceholder} /></label>
        <button className="button button-primary" type="submit">{copy.setBudget}</button>
      </form> : null}
      {canManageBranches ? <form action={setMasterActiveAction.bind(null,"branches",branch.id,branch.status !== "Active")}>
        <button className="button button-secondary" type="submit">{branch.status === "Active" ? common.deactivate : common.activate}</button>
      </form> : null}
    </div></section> : null}
  </>;
}
