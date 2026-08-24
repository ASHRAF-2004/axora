import { PageHeader } from "@/components/PageHeader";
import { PermissionEditorForm } from "@/components/PermissionEditorForm";
import { StatusBadge } from "@/components/StatusBadge";
import { AccessAdministrationUnavailableError, loadAccessAdministration } from "@/lib/access-administration";
import { accessAdministrationMessages, accessAdministrationNotice } from "@/lib/access-administration-i18n";
import { requirePagePermission } from "@/lib/auth";
import { isMvpVisiblePermission } from "@/lib/mvp-permissions";
import { localizePermissionOption } from "@/lib/permission-catalog-i18n";
import { localizedAccountRole } from "@/lib/user-form-i18n";
import Link from "next/link";
import { notFound } from "next/navigation";
import { replacePermissionSetAction } from "./actions";

const text = {
  en: { back: "Back to users", permissions: "Permissions", description: "Choose the permissions needed for this person’s role. Saving applies immediately and refreshes their sessions.", effective: "Effective permission: Allowed", identity: "Account" },
  ar: { back: "العودة إلى المستخدمين", permissions: "الصلاحيات", description: "اختر الصلاحيات اللازمة لدور هذا الشخص. يطبق الحفظ فوراً ويحدث جلساته.", effective: "الصلاحية الفعلية: مسموح", identity: "الحساب" },
  ms: { back: "Kembali ke pengguna", permissions: "Kebenaran", description: "Pilih kebenaran yang diperlukan untuk peranan pengguna ini. Simpan digunakan serta-merta dan menyegarkan sesi mereka.", effective: "Kebenaran berkesan: Dibenarkan", identity: "Akaun" },
} as const;

export default async function UserAccessPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ assignment?: string; notice?: string }>;
}) {
  const actor = await requirePagePermission("manage_users");
  const locale = actor.preferredLocale ?? "en";
  const copy = accessAdministrationMessages(locale);
  const local = text[locale];
  const [{ id }, query] = await Promise.all([params, searchParams]);
  let snapshot: Awaited<ReturnType<typeof loadAccessAdministration>>;
  try {
    snapshot = await loadAccessAdministration(actor, id, query.assignment);
  } catch (error) {
    if (error instanceof AccessAdministrationUnavailableError) notFound();
    throw error;
  }
  const assignment = snapshot.assignments.find((item) => item.id === snapshot.selectedAssignmentId);
  if (!assignment) notFound();
  const options = snapshot.permissionOptions
    .filter((permission) => isMvpVisiblePermission(snapshot.identity.accountKind, permission.code))
    .map((permission) => localizePermissionOption(permission, locale));
  const notice = accessAdministrationNotice(locale, query.notice);
  const back = "/users";
  return <>
    <PageHeader eyebrow={copy.eyebrow} title={copy.title(snapshot.identity.displayName)} description={local.description} />
    <div className="page-actions"><Link className="button button-secondary" href={back}>{local.back}</Link></div>
    {notice ? <div className="form-success" role="status"><strong>{notice}</strong>{query.notice === "permissions-updated" ? <p>{local.effective}</p> : null}</div> : null}
    <section className="panel"><div className="panel-header"><div><h2>{local.identity}</h2><p>{snapshot.identity.email}</p></div><StatusBadge status={snapshot.identity.accountStatus}>{snapshot.identity.accountStatus}</StatusBadge></div><dl className="summary-list"><div><dt>{copy.assignment}</dt><dd>{localizedAccountRole(assignment.roleKey, locale)?.label ?? assignment.roleLabel}</dd></div><div><dt>{copy.account}</dt><dd>{snapshot.identity.accountKind}</dd></div></dl></section>
    {snapshot.canManagePermissions ? <section><div className="panel-header"><div><h2>{local.permissions}</h2><p>{local.description}</p></div></div><PermissionEditorForm locale={locale} action={replacePermissionSetAction.bind(null, snapshot.identity.id, snapshot.selectedAssignmentId)} options={options.map((permission) => ({ code: permission.code, group: permission.group, label: permission.label, description: permission.description, highRisk: permission.highRisk }))} initialPermissions={options.filter((permission) => permission.effective).map((permission) => permission.code)} /></section> : null}
  </>;
}
