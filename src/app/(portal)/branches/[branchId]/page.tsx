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
import { AddBranchBudgetForm } from "@/components/AddBranchBudgetForm";
import { BranchActiveButton } from "@/components/BranchActiveButton";
import { DeleteBranchButton } from "@/components/DeleteBranchButton";

const localCopy = {
  en: { back: "Back to branches",details: "Branch information",budget: "Budget",editLocation: "Edit delivery address",locationRequired: "Delivery location required",locationReady: "Delivery location confirmed",people: "People",assigned: (count: number) => `${count} assigned`,viewPeople: "View people",viewBudget: "View budget",addBudget: "Add budget",amount: "Amount",budgetHelp: "Available company funds are checked before this is added.",adding: "Adding…",budgetAdded: "Budget updated.",budgetInvalid: "Enter a valid positive MYR amount with up to two decimal places.",budgetUnavailable: "Budget could not be added. Check available company funds and try again.",activeUnavailable: "This branch cannot be updated.",activeDelivery: "Finish or cancel the active delivery before deactivating this branch.",activeCart: "Finish or clear the active cart before deactivating this branch.",activeRequest: "Finish or cancel the active request before deactivating this branch.",delete: "Delete branch",deleteTitle: "Delete this branch permanently?",deleteBody: "Only an empty branch with no history can be deleted. Used branches can only be deactivated.",deleteConfirm: "Delete branch",deleteUsed: "Used branches can only be deactivated.",deleteUnavailable: "This branch cannot be deleted." },
  ar: { back: "العودة إلى الفروع",details: "معلومات الفرع",budget: "الميزانية",editLocation: "تعديل عنوان التسليم",locationRequired: "موقع التسليم مطلوب",locationReady: "تم تأكيد موقع التسليم",people: "الأشخاص",assigned: (count: number) => `${count} معيّنون`,viewPeople: "عرض الأشخاص",viewBudget: "عرض الميزانية",addBudget: "إضافة ميزانية",amount: "المبلغ",budgetHelp: "يتم التحقق من الأموال المتاحة للشركة قبل الإضافة.",adding: "جارٍ الإضافة…",budgetAdded: "تم تحديث الميزانية.",budgetInvalid: "أدخل مبلغ MYR موجباً صالحاً حتى منزلتين عشريتين.",budgetUnavailable: "تعذرت إضافة الميزانية. تحقق من أموال الشركة المتاحة وحاول مرة أخرى.",activeUnavailable: "لا يمكن تحديث هذا الفرع.",activeDelivery: "أكمل أو ألغِ التسليم النشط قبل إلغاء تفعيل هذا الفرع.",activeCart: "أكمل أو أفرغ السلة النشطة قبل إلغاء تفعيل هذا الفرع.",activeRequest: "أكمل أو ألغِ الطلب النشط قبل إلغاء تفعيل هذا الفرع.",delete: "حذف الفرع",deleteTitle: "حذف هذا الفرع نهائياً؟",deleteBody: "يمكن حذف فرع فارغ بلا سجل فقط. لا يمكن إلا إلغاء تفعيل الفروع المستخدمة.",deleteConfirm: "حذف الفرع",deleteUsed: "لا يمكن إلا إلغاء تفعيل الفروع المستخدمة.",deleteUnavailable: "لا يمكن حذف هذا الفرع." },
  ms: { back: "Kembali ke cawangan",details: "Maklumat cawangan",budget: "Bajet",editLocation: "Edit alamat penghantaran",locationRequired: "Lokasi penghantaran diperlukan",locationReady: "Lokasi penghantaran disahkan",people: "Orang",assigned: (count: number) => `${count} ditugaskan`,viewPeople: "Lihat orang",viewBudget: "Lihat bajet",addBudget: "Tambah bajet",amount: "Amaun",budgetHelp: "Dana syarikat yang tersedia diperiksa sebelum ini ditambah.",adding: "Menambah…",budgetAdded: "Bajet dikemas kini.",budgetInvalid: "Masukkan amaun MYR positif yang sah dengan sehingga dua tempat perpuluhan.",budgetUnavailable: "Bajet tidak dapat ditambah. Semak dana syarikat yang tersedia dan cuba lagi.",activeUnavailable: "Cawangan ini tidak dapat dikemas kini.",activeDelivery: "Selesaikan atau batalkan penghantaran aktif sebelum menyahaktifkan cawangan ini.",activeCart: "Selesaikan atau kosongkan troli aktif sebelum menyahaktifkan cawangan ini.",activeRequest: "Selesaikan atau batalkan permintaan aktif sebelum menyahaktifkan cawangan ini.",delete: "Padam cawangan",deleteTitle: "Padam cawangan ini secara kekal?",deleteBody: "Hanya cawangan kosong tanpa sejarah boleh dipadam. Cawangan yang digunakan hanya boleh dinyahaktifkan.",deleteConfirm: "Padam cawangan",deleteUsed: "Cawangan yang digunakan hanya boleh dinyahaktifkan.",deleteUnavailable: "Cawangan ini tidak boleh dipadam." },
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
      </dl><div className="form-actions"><Link className="button button-secondary" href={`/budgets/${branch.id}`}>{local.viewBudget}</Link>{canAccess(actor, "manage_branch_budget") && branch.status === "Active" ? <AddBranchBudgetForm branchId={branch.id} copy={{ add: local.addBudget, amount: local.amount, help: local.budgetHelp, cancel: common.back, adding: local.adding, success: local.budgetAdded, invalid: local.budgetInvalid, unavailable: local.budgetUnavailable }} /> : null}</div></article> : null}
      <article className="panel"><h2>{local.people}</h2><p>{local.assigned(assignedPeople.length)}</p>
        {canAccess(actor, "manage_users") ? <Link className="button button-secondary" href={`/branches/${branch.id}/people`}>{local.viewPeople}</Link> : null}
      </article>
    </section>
    {canManageBranches ? <section className="panel"><h2>{common.actions}</h2><div className="detail-grid">
      <BranchActiveButton branchId={branch.id} active={branch.status === "Active"} copy={{ deactivate: common.deactivate, activate: common.activate, unavailable: local.activeUnavailable, activeDelivery: local.activeDelivery, activeCart: local.activeCart, activeRequest: local.activeRequest }} />
      <DeleteBranchButton branchId={branch.id} copy={{ label: local.delete, title: local.deleteTitle,
        body: local.deleteBody, confirm: local.deleteConfirm, cancel: common.back,
        used: local.deleteUsed, unavailable: local.deleteUnavailable }} />
    </div></section> : null}
  </>;
}
