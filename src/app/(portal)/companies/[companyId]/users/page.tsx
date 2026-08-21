import Link from "next/link";
import { notFound } from "next/navigation";
import { InvitationResendForm } from "@/components/InvitationResendForm";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { UserAvatar } from "@/components/UserAvatar";
import { requirePagePermission } from "@/lib/auth";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import {
  peopleWorkspaceMessages,
  peopleWorkspaceText,
} from "@/lib/people-workspaces-i18n";
import { accountRoleLabel } from "@/lib/role-catalog";
import { localizedAccountRole } from "@/lib/user-form-i18n";
import { listAuthorizedUsers } from "@/lib/user-isolation";
import { canAccess } from "@/lib/permissions";
import { corePortalMessages } from "@/lib/core-portal-i18n";

export default async function CompanyUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await requirePagePermission("manage_users");
  const locale = actor.preferredLocale ?? "en";
  const copy = peopleWorkspaceMessages(locale);
  const { companyId } = await params;
  const [directory, authorizedUsers, parameters] = await Promise.all([
    loadOrganizationDirectory(actor),
    listAuthorizedUsers(actor),
    searchParams,
  ]);
  const company = directory.companies.find((item) => item.id === companyId);
  if (!company) notFound();
  const users = authorizedUsers.filter((user) => (
    user.accountKind === "COMPANY"
    && user.companyId === company.id
    && user.accountStatus !== "DEACTIVATED"
  ));
  const description = peopleWorkspaceText(locale, "companyDescription", { company: company.name });
  const standardNotice = parameters.notice
    ? corePortalMessages(locale).notices[parameters.notice]
    : undefined;
  const localNotice = parameters.notice === "user-creation-invalid"
    ? { message: copy.invalidUser, tone: "error" as const }
    : parameters.notice === "user-permission-selection-unavailable"
      ? { message: copy.unavailablePermissions, tone: "error" as const }
      : undefined;
  const notice = standardNotice ?? localNotice;
  return <>
    <PageHeader eyebrow={copy.companyEyebrow} title={`${copy.companyTitle}: ${company.name}`} description={description} />
    <div className="page-actions">
      <Link className="button button-secondary" href={`/companies/${company.id}`}>{copy.backCompany}</Link>
      {canAccess(actor, "create_company_users") ? <Link className="button button-primary" href={`/companies/${company.id}/users/new`}>{copy.createCompany}</Link> : null}
    </div>
    {notice ? <div className={notice.tone === "error" ? "form-alert" : "callout"} role={notice.tone === "error" ? "alert" : "status"}><strong>{notice.message}</strong></div> : null}
    <section className="panel">
      {users.length ? <div className="data-table-wrap"><table className="data-table">
        <thead><tr><th>{copy.user}</th><th>{copy.role}</th><th>{copy.scope}</th><th>{copy.status}</th><th>{copy.action}</th></tr></thead>
        <tbody>{users.map((user) => {
          const scope = user.departmentName ?? user.branchName ?? copy.companyScope;
          const status = !user.active ? copy.inactive : user.accountSetupCompletedAt ? copy.active : copy.pending;
          return <tr key={user.id}>
            <td><div className="profile-user-cell"><UserAvatar name={user.displayName} size={40} userId={user.avatarAvailable ? user.id : undefined} /><div><strong>{user.displayName}</strong>{user.jobTitle ? ` · ${user.jobTitle}` : ""}<br /><span className="subtle">{user.email}</span></div></div></td>
            <td>{localizedAccountRole(user.role, locale)?.label ?? accountRoleLabel(user.role)}</td>
            <td>{scope}</td>
            <td><StatusBadge status={status}>{status}</StatusBadge></td>
            <td><div className="action-row">
              <Link className="button button-secondary" href={`/users/${user.id}/access`}>{copy.openAccess}</Link>
              {user.active && !user.accountSetupCompletedAt ? <InvitationResendForm userId={user.id} userName={user.displayName} locale={locale} /> : null}
            </div></td>
          </tr>;
        })}</tbody>
      </table></div> : <p>{copy.noUsers}</p>}
    </section>
  </>;
}
