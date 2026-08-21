import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { getCompanyDeletionImpact } from "@/lib/company-deletion";
import {
  findAuthorizedCompanyLifecycleRecord,
  loadCompanyLifecycleWorkspace,
  type CompanyLifecycleAction,
  type CompanyLifecycleStatus,
} from "@/lib/company-lifecycle";
import {
  companyLifecycleActionLabel,
  companyLifecycleMessages,
  companyLifecycleStatusLabel,
} from "@/lib/company-lifecycle-i18n";
import {
  activateCompanyAction,
  inviteCompanyAdministratorAction,
  resolveCompanyDuplicateAction,
  setCompanyPublicationAction,
  suspendCompanyAction,
  syncCompanyAdministratorAction,
  transitionCompanyLifecycleAction,
} from "../../masters/actions";
import { deleteOrArchiveCompanyAction } from "../deletion-actions";

const transitionTargets: Partial<Record<CompanyLifecycleAction, CompanyLifecycleStatus>> = {
  START_REVIEW: "UNDER_REVIEW", MARK_CONTACTED: "CONTACTED", REQUEST_INFORMATION: "INFORMATION_PENDING",
  START_ONBOARDING: "ONBOARDING", CREATE_PORTAL_DRAFT: "PORTAL_DRAFT", SUBMIT_COMPANY_REVIEW: "COMPANY_REVIEW",
  MARK_INACTIVE: "INACTIVE", ARCHIVE: "ARCHIVED", MARK_DUPLICATE: "DUPLICATE", REJECT: "REJECTED",
};

const detailCopy = {
  en: { back: "Back to companies", onboarding: "Onboarding", theme: "Theme review", access: "Access and lifecycle", enabled: "Portal access enabled", disabled: "Portal access disabled", manager: "Primary Agent", noManager: "No primary Agent assigned", actions: "Company actions", adminName: "Administrator name", adminEmail: "Administrator email", locale: "Language", invite: "Send secure invitation", reason: "Reason", publish: "Public listing", deletion: "Deletion impact", protected: "Protected accounting or delivery evidence prevents permanent deletion. Access will be revoked and only required evidence retained.", hard: "Disposable child records will be deleted in ownership order; permanent deletion is available.", archive: "Work is still in progress. Deletion is blocked until it is resolved.", users: "Users", memberships: "Memberships", branches: "Branches", departments: "Departments", roles: "Role assignments", sessions: "Sessions", requests: "Requests", budgets: "Budgets", approvals: "Approval policies", invoices: "Invoices", deliveries: "Deliveries", receipts: "Receipts", documents: "Documents", branding: "Branding records", notifications: "Notifications", workflow: "Workflow events", history: "Lifecycle history", invitations: "Pending invitations", email: "Pending email", inFlight: "Work in progress", evidence: "Protected evidence", files: "External files", permanent: "Permanently delete company and disposable records", archiveAction: "Archive company and revoke access", blockedAction: "Deletion unavailable while work is active", type: "Type", confirm: "Confirm irreversible action", open: "Open company" },
  ar: { back: "العودة إلى الشركات", onboarding: "الإعداد", theme: "مراجعة السمة", access: "الوصول ودورة الحياة", enabled: "بوابة الشركة مفعلة", disabled: "بوابة الشركة معطلة", manager: "الوكيل الأساسي", noManager: "لا يوجد وكيل أساسي", actions: "إجراءات الشركة", adminName: "اسم المسؤول", adminEmail: "بريد المسؤول", locale: "اللغة", invite: "إرسال دعوة آمنة", reason: "السبب", publish: "الإدراج العام", deletion: "أثر الحذف", protected: "تمنع الأدلة المحاسبية أو أدلة التسليم المحمية الحذف الدائم. سيُلغى الوصول وتُحتفظ الأدلة المطلوبة فقط.", hard: "ستُحذف السجلات التابعة القابلة للإزالة بترتيب الملكية؛ الحذف الدائم متاح.", archive: "لا يزال هناك عمل جارٍ. الحذف محظور حتى تتم معالجته.", users: "المستخدمون", memberships: "العضويات", branches: "الفروع", departments: "الأقسام", roles: "إسنادات الأدوار", sessions: "الجلسات", requests: "الطلبات", budgets: "الميزانيات", approvals: "سياسات الاعتماد", invoices: "الفواتير", deliveries: "عمليات التسليم", receipts: "إيصالات الاستلام", documents: "المستندات", branding: "سجلات العلامة", notifications: "الإشعارات", workflow: "أحداث سير العمل", history: "سجل دورة الحياة", invitations: "الدعوات المعلقة", email: "البريد المعلق", inFlight: "العمل الجاري", evidence: "الأدلة المحمية", files: "الملفات الخارجية", permanent: "حذف الشركة والسجلات القابلة للإزالة نهائياً", archiveAction: "أرشفة الشركة وإلغاء الوصول", blockedAction: "الحذف غير متاح أثناء وجود عمل نشط", type: "اكتب", confirm: "تأكيد الإجراء غير القابل للتراجع", open: "فتح الشركة" },
  ms: { back: "Kembali ke syarikat", onboarding: "Penyediaan", theme: "Semakan tema", access: "Akses dan kitar hayat", enabled: "Akses portal didayakan", disabled: "Akses portal dinyahdayakan", manager: "Ejen utama", noManager: "Tiada Ejen utama ditugaskan", actions: "Tindakan syarikat", adminName: "Nama pentadbir", adminEmail: "E-mel pentadbir", locale: "Bahasa", invite: "Hantar jemputan selamat", reason: "Sebab", publish: "Senarai awam", deletion: "Kesan pemadaman", protected: "Bukti perakaunan atau penghantaran yang dilindungi menghalang pemadaman kekal. Akses akan dibatalkan dan hanya bukti yang diperlukan dikekalkan.", hard: "Rekod anak yang boleh dilupuskan akan dipadam mengikut susunan pemilikan; pemadaman kekal tersedia.", archive: "Kerja masih berjalan. Pemadaman disekat sehingga ia diselesaikan.", users: "Pengguna", memberships: "Keahlian", branches: "Cawangan", departments: "Jabatan", roles: "Tugasan peranan", sessions: "Sesi", requests: "Permintaan", budgets: "Bajet", approvals: "Polisi kelulusan", invoices: "Invois", deliveries: "Penghantaran", receipts: "Penerimaan", documents: "Dokumen", branding: "Rekod jenama", notifications: "Pemberitahuan", workflow: "Peristiwa aliran kerja", history: "Sejarah kitar hayat", invitations: "Jemputan belum selesai", email: "E-mel belum selesai", inFlight: "Kerja sedang berjalan", evidence: "Bukti dilindungi", files: "Fail luaran", permanent: "Padam syarikat dan rekod yang boleh dilupuskan secara kekal", archiveAction: "Arkib syarikat dan batalkan akses", blockedAction: "Pemadaman tidak tersedia semasa kerja aktif", type: "Taip", confirm: "Sahkan tindakan tidak boleh balik", open: "Buka syarikat" },
} as const;

export default async function CompanyDetailPage({ params }: { params: Promise<{ companyId: string }> }) {
  const actor = await requirePagePermission("manage_companies");
  const locale = actor.preferredLocale ?? "en";
  const copy = companyLifecycleMessages(locale);
  const local = detailCopy[locale];
  const { companyId } = await params;
  const workspace = await loadCompanyLifecycleWorkspace(actor);
  const company = findAuthorizedCompanyLifecycleRecord(workspace, companyId);
  if (!company || company.status === "ARCHIVED") notFound();
  const actions = new Set(company.availableActions);
  const assignmentActions = new Set(["ASSIGN", "REASSIGN", "ADD_BACKUP", "REPLACE_BACKUP"]);
  const hasLifecycleActions = company.availableActions.some((action) => !assignmentActions.has(action));
  const impact = actor.isOwner ? await getCompanyDeletionImpact(actor, company.id) : null;
  return <>
    <PageHeader eyebrow={copy.eyebrow} title={company.name} description={company.companyInformation ?? copy.description} />
    <div className="page-actions"><Link className="button button-secondary" href="/companies">{local.back}</Link>{actor.isOwner && actor.accountKind === "PLATFORM" ? <Link className="button button-secondary" href={`/companies/${company.id}/assignment`}>{copy.coverageAndHandover}</Link> : null}{canAccess(actor, "manage_users") ? <Link className="button button-secondary" href={`/companies/${company.id}/users`}>{local.users}</Link> : null}<Link className="button button-secondary" href={`/companies/${company.id}/onboarding`}>{local.onboarding}</Link><Link className="button button-secondary" href={`/companies/${company.id}/theme`}>{local.theme}</Link></div>
    <section className="detail-grid">
      <article className="panel"><h2>{copy.companyInformation}</h2><dl className="summary-list"><div><dt>{copy.status}</dt><dd><StatusBadge status={company.status}>{companyLifecycleStatusLabel(locale, company.status)}</StatusBadge></dd></div><div><dt>{copy.industry}</dt><dd>{company.industry}</dd></div><div><dt>{copy.mainContact}</dt><dd>{company.mainContactName}</dd></div><div><dt>{copy.billingCycle}</dt><dd>{company.billingCycle}</dd></div></dl></article>
      <article className="panel"><h2>{local.access}</h2><p>{company.portalAccessEnabled ? local.enabled : local.disabled}</p><p>{company.primaryManager ? `${local.manager}: ${company.primaryManager.name}` : local.noManager}</p></article>
    </section>
    {hasLifecycleActions ? <section className="panel"><h2>{local.actions}</h2><div className="detail-grid">
      {(Object.entries(transitionTargets) as Array<[CompanyLifecycleAction, CompanyLifecycleStatus]>).filter(([action]) => actions.has(action)).map(([action, toStatus]) => <form action={transitionCompanyLifecycleAction} className="table-action-stack" key={action}><input type="hidden" name="companyId" value={company.id} /><input type="hidden" name="toStatus" value={toStatus} /><label>{local.reason}<input name="reason" minLength={3} maxLength={1000} required /></label><button className="button button-secondary">{companyLifecycleActionLabel(locale, action)}</button></form>)}
      {actions.has("INVITE_ADMINISTRATOR") ? <form action={inviteCompanyAdministratorAction} className="form-grid"><input type="hidden" name="companyId" value={company.id} /><label>{local.adminName}<input name="displayName" defaultValue={company.mainContactName} required /></label><label>{local.adminEmail}<input name="email" type="email" required /></label><label>{local.locale}<select name="preferredLocale" defaultValue={locale}><option value="en">English</option><option value="ar">العربية</option><option value="ms">Bahasa Melayu</option></select></label><button className="button button-primary" type="submit">{local.invite}</button></form> : null}
      {actions.has("SYNC_ADMINISTRATOR") ? <form action={syncCompanyAdministratorAction}><input type="hidden" name="companyId" value={company.id} /><button className="button button-secondary">{companyLifecycleActionLabel(locale, "SYNC_ADMINISTRATOR")}</button></form> : null}
      {actions.has("ACTIVATE") && !company.activationBlockedReasons.length ? <form action={activateCompanyAction} className="table-action-stack"><input type="hidden" name="companyId" value={company.id} /><label>{local.reason}<input name="reason" minLength={3} maxLength={1000} required /></label><button className="button button-primary">{companyLifecycleActionLabel(locale, "ACTIVATE")}</button></form> : null}
      {actions.has("SUSPEND") ? <form action={suspendCompanyAction} className="table-action-stack"><input type="hidden" name="companyId" value={company.id} /><label>{local.reason}<input name="reason" minLength={3} maxLength={1000} required /></label><button className="button button-secondary">{companyLifecycleActionLabel(locale, "SUSPEND")}</button></form> : null}
      {actions.has("PUBLISH") || actions.has("UNPUBLISH") ? <form action={setCompanyPublicationAction} className="table-action-stack"><input type="hidden" name="companyId" value={company.id} /><input type="hidden" name="isPubliclyListed" value={actions.has("PUBLISH") ? "true" : "false"} /><label>{local.reason}<input name="reason" minLength={3} maxLength={1000} required /></label><button className="button button-secondary">{companyLifecycleActionLabel(locale, actions.has("PUBLISH") ? "PUBLISH" : "UNPUBLISH")}</button></form> : null}
      {actions.has("CLEAR_DUPLICATE") ? (["CLEAR", "CONFIRM"] as const).map((decision) => <form action={resolveCompanyDuplicateAction} className="table-action-stack" key={decision}><input type="hidden" name="companyId" value={company.id} /><input type="hidden" name="decision" value={decision} /><label>{local.reason}<input name="reason" minLength={3} maxLength={1000} required /></label><button className="button button-secondary">{companyLifecycleActionLabel(locale, decision === "CLEAR" ? "CLEAR_DUPLICATE" : "MARK_DUPLICATE")}</button></form>) : null}
    </div></section> : null}
    {impact ? <section className="panel"><h2>{local.deletion}</h2><p>{impact.recommendedMode === "ARCHIVE_RETAIN" ? local.protected : impact.recommendedMode === "HARD_DELETE" ? local.hard : local.archive}</p><dl className="summary-list">{[
      [local.users, impact.users], [local.memberships, impact.memberships], [local.branches, impact.branches],
      [local.departments, impact.departments], [local.roles, impact.roleAssignments], [local.sessions, impact.sessions],
      [local.requests, impact.requests], [local.budgets, impact.budgets], [local.approvals, impact.approvalPolicies],
      [local.invoices, impact.invoices], [local.deliveries, impact.deliveries], [local.receipts, impact.receipts],
      [local.documents, impact.documents], [local.branding, impact.branding], [local.notifications, impact.notifications],
      [local.workflow, impact.workflowEvents], [local.history, impact.lifecycleHistory], [local.invitations, impact.pendingInvitations],
      [local.email, impact.pendingWorkflowEmails], [local.inFlight, impact.inFlightWork], [local.evidence, impact.protectedEvidence], [local.files, impact.externalFileCount],
    ].map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>{impact.recommendedMode !== "BLOCK" ? <details><summary>{impact.recommendedMode === "HARD_DELETE" ? local.permanent : local.archiveAction}</summary><form action={deleteOrArchiveCompanyAction.bind(null, company.id)} className="table-action-stack"><input type="hidden" name="commandId" value={randomUUID()} /><label>{local.reason}<textarea name="reason" minLength={3} maxLength={1000} required /></label><label>{local.type} <strong>{impact.confirmation}</strong><input name="confirmation" autoComplete="off" required /></label><button className="button button-secondary" type="submit">{local.confirm}</button></form></details> : <p className="subtle">{local.blockedAction}</p>}</section> : null}
  </>;
}
