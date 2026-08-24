import {
  CompanyActivationForm,
  CompanyVerificationApprovalForm,
} from "@/components/CompanyActivationControls";
import { CompanyWorkspaceNav } from "@/components/CompanyWorkspaceNav";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import {
  findAuthorizedCompanyLifecycleRecord,
  loadCompanyActivationContract,
  loadCompanyLifecycleWorkspace,
} from "@/lib/company-lifecycle";
import {
  companyLifecycleMessages,
  companyLifecycleStatusLabel,
} from "@/lib/company-lifecycle-i18n";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import {
  inviteCompanyAdministratorAction,
  suspendCompanyAction,
} from "../../masters/actions";
import { deleteOrArchiveCompanyAction } from "../deletion-actions";

const text = {
  en: {
    created: "Company created. Continue setup to prepare the workspace.",
    details: "Company details",
    setup: "Continue setup",
    contact: "Main contact",
    industry: "Industry",
    website: "Website",
    actions: "Company actions",
    activate: "Activate company",
    activating: "Activating…",
    suspend: "Suspend company",
    confirmSuspend: "Suspend this company?",
    remove: "Delete company",
    confirmRemove: "Delete this company?",
    admin: "Create Company Administrator",
    adminName: "Administrator name",
    adminEmail: "Administrator email",
    language: "Language",
    invite: "Send secure invitation",
    back: "Back to companies",
    unavailable: "Not provided",
    verification: "Company verification",
    verificationRequired: "Verification required before activation.",
    verificationPending: "Owner verification is pending before activation.",
    verificationChanges: "Verification changes must be completed before activation.",
    verified: "Company verification is approved.",
    approveVerification: "Approve verification",
    approvingVerification: "Approving…",
    blockers: "Activation requirements",
    blockedHelp: "Complete these requirements before activation.",
    activationSuccess: "Company activated successfully. Portal access is now enabled.",
    verificationSuccess: "Company verification approved. Activation requirements were refreshed.",
    stale: "The company changed after this page loaded. Review the current state and try again.",
    activationBlocked: "Activation is still unavailable because one or more requirements changed.",
    verificationBlocked: "Verification is unavailable until the current readiness requirements are complete.",
    alreadyActive: "This company is already active.",
    alreadyVerified: "This company is already verified.",
  },
  ar: {
    created: "تم إنشاء الشركة. تابع الإعداد لتجهيز مساحة العمل.",
    details: "تفاصيل الشركة",
    setup: "متابعة الإعداد",
    contact: "جهة الاتصال الرئيسية",
    industry: "القطاع",
    website: "الموقع الإلكتروني",
    actions: "إجراءات الشركة",
    activate: "تفعيل الشركة",
    activating: "جارٍ التفعيل…",
    suspend: "تعليق الشركة",
    confirmSuspend: "تعليق هذه الشركة؟",
    remove: "حذف الشركة",
    confirmRemove: "حذف هذه الشركة؟",
    admin: "إنشاء مسؤول الشركة",
    adminName: "اسم المسؤول",
    adminEmail: "بريد المسؤول",
    language: "اللغة",
    invite: "إرسال دعوة آمنة",
    back: "العودة إلى الشركات",
    unavailable: "غير متوفر",
    verification: "التحقق من الشركة",
    verificationRequired: "يلزم التحقق قبل تفعيل الشركة.",
    verificationPending: "التحقق من المالك معلّق قبل التفعيل.",
    verificationChanges: "يجب إكمال تعديلات التحقق قبل التفعيل.",
    verified: "تم اعتماد التحقق من الشركة.",
    approveVerification: "اعتماد التحقق",
    approvingVerification: "جارٍ الاعتماد…",
    blockers: "متطلبات التفعيل",
    blockedHelp: "أكمل هذه المتطلبات قبل التفعيل.",
    activationSuccess: "تم تفعيل الشركة بنجاح. أصبح الوصول إلى البوابة متاحاً الآن.",
    verificationSuccess: "تم اعتماد التحقق من الشركة وتحديث متطلبات التفعيل.",
    stale: "تغيّرت بيانات الشركة بعد تحميل الصفحة. راجع الحالة الحالية وحاول مجدداً.",
    activationBlocked: "لا يزال التفعيل غير متاح لأن متطلباً واحداً أو أكثر قد تغيّر.",
    verificationBlocked: "لا يتوفر التحقق حتى تكتمل متطلبات الجاهزية الحالية.",
    alreadyActive: "هذه الشركة مفعّلة بالفعل.",
    alreadyVerified: "تم التحقق من هذه الشركة بالفعل.",
  },
  ms: {
    created: "Syarikat dicipta. Teruskan persediaan untuk menyediakan ruang kerja.",
    details: "Butiran syarikat",
    setup: "Teruskan persediaan",
    contact: "Hubungan utama",
    industry: "Industri",
    website: "Laman web",
    actions: "Tindakan syarikat",
    activate: "Aktifkan syarikat",
    activating: "Mengaktifkan…",
    suspend: "Gantung syarikat",
    confirmSuspend: "Gantung syarikat ini?",
    remove: "Padam syarikat",
    confirmRemove: "Padam syarikat ini?",
    admin: "Cipta Pentadbir Syarikat",
    adminName: "Nama pentadbir",
    adminEmail: "E-mel pentadbir",
    language: "Bahasa",
    invite: "Hantar jemputan selamat",
    back: "Kembali ke syarikat",
    unavailable: "Tidak diberikan",
    verification: "Pengesahan syarikat",
    verificationRequired: "Pengesahan diperlukan sebelum pengaktifan.",
    verificationPending: "Pengesahan Pemilik masih menunggu sebelum pengaktifan.",
    verificationChanges: "Perubahan pengesahan mesti dilengkapkan sebelum pengaktifan.",
    verified: "Pengesahan syarikat telah diluluskan.",
    approveVerification: "Luluskan pengesahan",
    approvingVerification: "Meluluskan…",
    blockers: "Keperluan pengaktifan",
    blockedHelp: "Lengkapkan keperluan ini sebelum pengaktifan.",
    activationSuccess: "Syarikat berjaya diaktifkan. Akses portal kini didayakan.",
    verificationSuccess: "Pengesahan syarikat diluluskan dan keperluan pengaktifan dikemas kini.",
    stale: "Syarikat berubah selepas halaman ini dimuatkan. Semak keadaan semasa dan cuba lagi.",
    activationBlocked: "Pengaktifan masih tidak tersedia kerana satu atau lebih keperluan telah berubah.",
    verificationBlocked: "Pengesahan tidak tersedia sehingga keperluan kesediaan semasa lengkap.",
    alreadyActive: "Syarikat ini sudah aktif.",
    alreadyVerified: "Syarikat ini sudah disahkan.",
  },
} as const;

const blockerText = {
  en: {
    ADMIN_ACTIVATION: "An active Company Administrator is required.",
    COMPANY_VERIFICATION_REQUIRED: "Company verification must be approved.",
    COMPANY_LIFECYCLE_REQUIRED: "Complete Company Administrator activation first.",
    COMPANY_SETUP_REQUIRED: "Complete the essential company setup details.",
  },
  ar: {
    ADMIN_ACTIVATION: "يلزم وجود مسؤول شركة نشط.",
    COMPANY_VERIFICATION_REQUIRED: "يجب اعتماد التحقق من الشركة.",
    COMPANY_LIFECYCLE_REQUIRED: "أكمل تفعيل مسؤول الشركة أولاً.",
    COMPANY_SETUP_REQUIRED: "أكمل بيانات إعداد الشركة الأساسية.",
  },
  ms: {
    ADMIN_ACTIVATION: "Pentadbir Syarikat yang aktif diperlukan.",
    COMPANY_VERIFICATION_REQUIRED: "Pengesahan syarikat mesti diluluskan.",
    COMPANY_LIFECYCLE_REQUIRED: "Lengkapkan pengaktifan Pentadbir Syarikat dahulu.",
    COMPANY_SETUP_REQUIRED: "Lengkapkan butiran persediaan syarikat yang penting.",
  },
} as const;

export default async function CompanyOverviewPage({ params, searchParams }: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await requirePagePermission("manage_companies");
  const locale = actor.preferredLocale ?? "en";
  const copy = companyLifecycleMessages(locale);
  const local = text[locale];
  const [{ companyId }, query, workspace] = await Promise.all([
    params,
    searchParams,
    loadCompanyLifecycleWorkspace(actor),
  ]);
  const company = findAuthorizedCompanyLifecycleRecord(workspace, companyId);
  if (!company || company.status === "ARCHIVED") notFound();
  const activationContract = await loadCompanyActivationContract(actor, company.id);
  const actions = new Set(company.availableActions);
  const notice = query.notice === "company-activated"
    ? { message: local.activationSuccess, success: true }
    : query.notice === "company-verification-approved"
      ? { message: local.verificationSuccess, success: true }
      : query.notice === "company-activation-stale" || query.notice === "company-verification-stale"
        ? { message: local.stale, success: false }
        : query.notice === "company-activation-blocked"
          ? { message: local.activationBlocked, success: false }
          : query.notice === "company-verification-blocked"
            ? { message: local.verificationBlocked, success: false }
            : query.notice === "company-already-active"
              ? { message: local.alreadyActive, success: true }
              : query.notice === "company-already-verified"
                ? { message: local.alreadyVerified, success: true }
                : null;
  const verificationMessage = activationContract.verificationStatus === "VERIFIED"
    ? local.verified
    : activationContract.verificationStatus === "PENDING_VERIFICATION"
      ? local.verificationPending
      : activationContract.verificationStatus === "CHANGES_REQUESTED"
        || activationContract.verificationStatus === "REJECTED"
        ? local.verificationChanges
        : local.verificationRequired;
  const blockerLabel = (blocker: string) => (
    blockerText[locale][blocker as keyof typeof blockerText.en] ?? blocker
  );

  return <>
    <PageHeader eyebrow={copy.eyebrow} title={company.name} description={copy.description} />
    {query.notice === "company-created" ? <div className="form-success" role="status"><strong>{local.created}</strong></div> : null}
    {notice ? <div className={notice.success ? "form-success" : "form-alert"} role={notice.success ? "status" : "alert"}><strong>{notice.message}</strong></div> : null}
    <CompanyWorkspaceNav companyId={company.id} locale={locale} active="overview" />
    <section className="detail-grid">
      <article className="panel">
        <div className="panel-header"><div><h2>{local.details}</h2><p className="subtle">{company.code}</p></div><StatusBadge status={company.status}>{companyLifecycleStatusLabel(locale, company.status)}</StatusBadge></div>
        <dl className="summary-list"><div><dt>{local.contact}</dt><dd>{company.mainContactName}</dd></div><div><dt>{local.industry}</dt><dd>{company.industry || local.unavailable}</dd></div><div><dt>{local.website}</dt><dd>{company.websiteUrl ?? local.unavailable}</dd></div></dl>
        <Link className="button button-primary" href={`/companies/${company.id}/onboarding`}>{local.setup}</Link>
      </article>
      <article className="panel form-panel">
        <h2>{local.admin}</h2>
        {actions.has("INVITE_ADMINISTRATOR") ? <form action={inviteCompanyAdministratorAction} className="form-grid"><input type="hidden" name="companyId" value={company.id} /><label>{local.adminName}<input name="displayName" defaultValue={company.mainContactName} required /></label><label>{local.adminEmail}<input name="email" type="email" required /></label><label>{local.language}<select name="preferredLocale" defaultValue={locale}><option value="en">English</option><option value="ar">العربية</option><option value="ms">Bahasa Melayu</option></select></label><div className="form-actions field-full"><button className="button button-primary" type="submit">{local.invite}</button></div></form> : <p className="subtle">{companyLifecycleStatusLabel(locale, company.status)}</p>}
      </article>
    </section>
    <section className="panel" aria-labelledby="company-verification-heading">
      <h2 id="company-verification-heading">{local.verification}</h2>
      <p>{verificationMessage}</p>
      {activationContract.verificationApprovalAvailable ? <div className="action-row"><CompanyVerificationApprovalForm companyId={company.id} expectedVersion={activationContract.verificationVersion} label={local.approveVerification} pendingLabel={local.approvingVerification} /></div> : null}
      {activationContract.verificationStatus !== "VERIFIED" && activationContract.verificationApprovalBlockers.length ? <ul>{activationContract.verificationApprovalBlockers.map((blocker) => <li key={blocker}>{blockerLabel(blocker)}</li>)}</ul> : null}
    </section>
    {(actions.has("ACTIVATE") || actions.has("SUSPEND")) ? <section className="panel" aria-labelledby="company-actions-heading">
      <h2 id="company-actions-heading">{local.actions}</h2>
      {actions.has("ACTIVATE") && company.activationBlockedReasons.length ? <><h3>{local.blockers}</h3><p className="subtle">{local.blockedHelp}</p><ul>{company.activationBlockedReasons.map((blocker) => <li key={blocker}>{blockerLabel(blocker)}</li>)}</ul></> : null}
      <div className="action-row">
        {actions.has("ACTIVATE") && !company.activationBlockedReasons.length ? <CompanyActivationForm companyId={company.id} expectedVersion={company.version} label={local.activate} pendingLabel={local.activating} /> : null}
        {actions.has("ACTIVATE") && company.activationBlockedReasons.length ? <button className="button button-primary" type="button" disabled aria-disabled="true">{local.activate}</button> : null}
        {actions.has("SUSPEND") ? <form action={suspendCompanyAction}><input type="hidden" name="companyId" value={company.id} /><button className="button button-secondary" type="submit" title={local.confirmSuspend}>{local.suspend}</button></form> : null}
      </div>
    </section> : null}
    {actor.isOwner ? <details className="panel"><summary>{local.remove}</summary><form action={deleteOrArchiveCompanyAction.bind(null, company.id)} className="form-grid"><input type="hidden" name="commandId" value={randomUUID()} /><label className="field-full"><input name="confirmed" type="checkbox" value="confirmed" required /> {local.confirmRemove}</label><div className="form-actions field-full"><button className="button button-danger" type="submit">{local.remove}</button></div></form></details> : null}
    <div className="page-actions"><Link className="button button-secondary" href="/companies">{local.back}</Link></div>
  </>;
}
