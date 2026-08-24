import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { loadBranchDeliveryLocationWorkspace } from "@/lib/branch-delivery-location";
import { branchDetailsMessages } from "@/lib/branch-details-i18n";
import { corePortalMessages,localizedStatus } from "@/lib/core-portal-i18n";
import { formatCurrency } from "@/lib/domain";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import { canAccess } from "@/lib/permissions";
import { listAuthorizedUsers } from "@/lib/user-isolation";
import { setMasterActiveAction } from "../../masters/actions";

const localCopy = {
  en: { back: "Back to branches",details: "Branch information",budget: "Budget",editLocation: "Edit delivery address",locationRequired: "Delivery location required",locationReady: "Delivery location confirmed",people: "People",assigned: (count: number) => `${count} assigned`,viewPeople: "View people",viewBudget: "View budget" },
  ar: { back: "العودة إلى الفروع",details: "معلومات الفرع",budget: "الميزانية",editLocation: "تعديل عنوان التسليم",locationRequired: "موقع التسليم مطلوب",locationReady: "تم تأكيد موقع التسليم",people: "الأشخاص",assigned: (count: number) => `${count} معيّنون`,viewPeople: "عرض الأشخاص",viewBudget: "عرض الميزانية" },
  ms: { back: "Kembali ke cawangan",details: "Maklumat cawangan",budget: "Bajet",editLocation: "Edit alamat penghantaran",locationRequired: "Lokasi penghantaran diperlukan",locationReady: "Lokasi penghantaran disahkan",people: "Orang",assigned: (count: number) => `${count} ditugaskan`,viewPeople: "Lihat orang",viewBudget: "Lihat bajet" },
} as const;

export default async function BranchDetailPage({ params }: { params: Promise<{ branchId: string }> }) {
  const actor = await requirePagePermission("view_branches");
  const locale = actor.preferredLocale ?? "en";
  const copy = corePortalMessages(locale).branches;
  const common = corePortalMessages(locale).common;
  const local = localCopy[locale];
  const detailsCopy = branchDetailsMessages(locale);
  const { branchId } = await params;
  const { branches } = await loadOrganizationDirectory(actor);
  const branch = branches.find((item) => item.id === branchId);
  if (!branch) notFound();
  const locationWorkspace = await loadBranchDeliveryLocationWorkspace(actor, branch.id)
    .catch(() => null);
  const canOpenDeliveryLocation = Boolean(locationWorkspace
    && (locationWorkspace.canManage || actor.accountKind === "PLATFORM"));
  const canManageBranches = canAccess(actor,"manage_branches");
  const assignedPeople = canAccess(actor, "manage_users")
    ? (await listAuthorizedUsers(actor)).filter((user) => (
      user.companyId === branch.companyId && user.branchId === branch.id
      && user.accountStatus !== "DEACTIVATED"
    ))
    : [];
  const locationReady = Boolean(locationWorkspace?.location?.coordinates);

  return <>
    <PageHeader eyebrow={copy.eyebrow} title={branch.name} description={`${branch.companyName} · ${branch.city}`} />
    <div className="page-actions"><Link className="button button-secondary" href="/branches">{local.back}</Link>
      {canManageBranches ? <Link className="button button-secondary" href={`/branches/${branch.id}/edit`}>{detailsCopy.edit}</Link> : null}
      {canOpenDeliveryLocation ? <Link className="button button-primary" href={`/branches/${branch.id}/delivery-location`}>{local.editLocation}</Link> : null}
    </div>
    <section className="detail-grid">
      <article className="panel"><h2>{local.details}</h2><dl className="summary-list">
        {actor.accountKind === "PLATFORM" ? <div><dt>{common.company}</dt><dd>{branch.companyName}</dd></div> : null}
        <div><dt>{copy.shortCode}</dt><dd>{branch.branchCode}</dd></div>
        <div><dt>{copy.delivery}</dt><dd>{branch.deliveryAddress}</dd></div>
        <div><dt>{local.editLocation}</dt><dd><StatusBadge status={locationReady ? "Active" : "Pending"}>{locationReady ? local.locationReady : local.locationRequired}</StatusBadge></dd></div>
        <div><dt>{copy.contactName}</dt><dd>{branch.contactName || detailsCopy.notProvided}</dd></div>
        <div><dt>{copy.contactPhone}</dt><dd><bdi>{branch.contactPhone || detailsCopy.notProvided}</bdi></dd></div>
        <div><dt>{copy.contactEmail}</dt><dd><bdi>{branch.contactEmail || detailsCopy.notProvided}</bdi></dd></div>
        <div><dt>{detailsCopy.deliveryInstructions}</dt><dd>{branch.deliveryInstructions || detailsCopy.notProvided}</dd></div>
        <div><dt>{detailsCopy.notes}</dt><dd>{branch.notes || detailsCopy.notProvided}</dd></div>
        <div><dt>{common.status}</dt><dd><StatusBadge status={branch.status}>{localizedStatus(branch.status,locale)}</StatusBadge></dd></div>
      </dl></article>
      {branch.canViewBudget ? <article className="panel"><h2>{local.budget}</h2><dl className="summary-list">
        <div><dt>{copy.monthlyBudget}</dt><dd>{branch.monthlyBudget == null ? common.notSet : formatCurrency(branch.monthlyBudget,locale)}</dd></div>
        <div><dt>{copy.committed}</dt><dd>{formatCurrency(branch.committedAmount ?? 0,locale)}</dd></div>
        <div><dt>{copy.available}</dt><dd>{branch.remainingAmount == null ? common.notSet : formatCurrency(branch.remainingAmount,locale)}</dd></div>
      </dl><Link className="button button-secondary" href={`/budgets/${branch.id}`}>{local.viewBudget}</Link></article> : null}
      <article className="panel"><h2>{local.people}</h2><p>{local.assigned(assignedPeople.length)}</p>
        {canAccess(actor, "manage_users") ? <Link className="button button-secondary" href={`/branches/${branch.id}/people`}>{local.viewPeople}</Link> : null}
      </article>
    </section>
    {canManageBranches ? <section className="panel"><h2>{common.actions}</h2><div className="detail-grid">
      {canManageBranches ? <form action={setMasterActiveAction.bind(null,"branches",branch.id,branch.status !== "Active")}>
        <button className="button button-secondary" type="submit">{branch.status === "Active" ? common.deactivate : common.activate}</button>
      </form> : null}
    </div></section> : null}
  </>;
}
