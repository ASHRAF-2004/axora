import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { UserCreateForm } from "@/components/UserCreateForm";
import { UserAvatar } from "@/components/UserAvatar";
import { InvitationResendForm } from "@/components/InvitationResendForm";
import { accessAdministrationMessages } from "@/lib/access-administration-i18n";
import { requirePagePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/domain";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import type { SupportedLocale } from "@/lib/i18n";
import { localizedAccountRole } from "@/lib/user-form-i18n";
import { creatableAccountRoles, accountRoleLabel } from "@/lib/role-catalog";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import { loadOrganizationStructureWorkspace } from "@/lib/organization-structure";
import { STANDARD_BILLING_TERMS, type Branch, type Company } from "@/lib/types";
import { listAuthorizedUsers } from "@/lib/user-isolation";
import { profileImageMessages } from "@/lib/profile-image-i18n";
import { defaultPermissionsForRole } from "@/lib/authorization-policy";
import { listGrantablePermissionOptions } from "@/lib/route-authorization";
import Link from "next/link";
import {
  setUserActiveAction,
  deactivateUserProfileImageAction,
} from "./actions";

function invitationStatus(user: Awaited<ReturnType<typeof listAuthorizedUsers>>[number]) {
  if (!user.active) return "Inactive";
  if (user.accountSetupCompletedAt) return "Active";
  if (user.accountSetupExpiresAt && new Date(user.accountSetupExpiresAt).getTime() <= Date.now()) {
    return "Invite expired";
  }
  if (user.accountSetupDeliveryStatus === "SENT") return "Invite sent";
  if (user.accountSetupDeliveryStatus === "SENDING") return "Sending email";
  if (user.accountSetupDeliveryStatus === "DISABLED") return "Delivery disabled";
  if (user.accountSetupDeliveryStatus === "FAILED") return "Email failed";
  if (user.accountSetupDeliveryStatus === "UNCERTAIN") return "Delivery unconfirmed";
  if (user.accountSetupDeliveryStatus === "CANCELLED") return "Invite replaced";
  if (user.accountSetupDeliveryStatus === "PENDING") return "Awaiting email";
  return "Pending setup";
}

function invitationTimeline(user: Awaited<ReturnType<typeof listAuthorizedUsers>>[number], locale: SupportedLocale, timeZone: string, copy: ReturnType<typeof corePortalMessages>["users"]) {
  if (user.accountSetupCompletedAt) return formatDateTime(user.lastLoginAt, locale, timeZone);
  if (user.accountSetupDeliveryStatus === "SENT" && user.accountSetupSentAt) {
    return copy.sentExpires(formatDateTime(user.accountSetupSentAt, locale, timeZone), formatDateTime(user.accountSetupExpiresAt, locale, timeZone));
  }
  if (user.accountSetupDeliveryStatus === "FAILED" && user.accountSetupDeliveryAttemptedAt) {
    return copy.failedAt(formatDateTime(user.accountSetupDeliveryAttemptedAt, locale, timeZone));
  }
  if (user.accountSetupDeliveryStatus === "UNCERTAIN") {
    return copy.deliveryUnknown;
  }
  if (user.accountSetupDeliveryStatus === "DISABLED") return copy.deliveryNotConfigured;
  if (user.accountSetupExpiresAt) return copy.expiresAt(formatDateTime(user.accountSetupExpiresAt, locale, timeZone));
  return copy.neverSignedIn;
}

export default async function UsersPage() {
  const actor = await requirePagePermission("manage_users");
  const locale = actor.preferredLocale ?? "en";
  const timeZone = actor.timezone ?? "Asia/Kuala_Lumpur";
  const copy = corePortalMessages(locale).users;
  const common = corePortalMessages(locale).common;
  const accessCopy = accessAdministrationMessages(locale);
  const imageCopy = profileImageMessages(locale);
  const availableRoles = creatableAccountRoles(actor);
  const [users, organization, structure, permissionOptions] = await Promise.all([
    listAuthorizedUsers(actor),
    loadOrganizationDirectory(actor),
    loadOrganizationStructureWorkspace(actor),
    listGrantablePermissionOptions(actor),
  ]);
  const companies: Company[] = organization.companies.map((company) => ({
    ...company,
    paymentTerms: STANDARD_BILLING_TERMS,
  }));
  const branches: Branch[] = organization.branches.map((branch) => ({
    ...branch,
    committedAmount: branch.committedAmount ?? 0,
  }));
  const activeAdminCounts = users.reduce<Record<string, number>>((counts, user) => {
    if (user.active && user.accountSetupCompletedAt
      && ["ADMIN", "COMPANY_ADMIN"].includes(user.role) && user.companyId) {
      counts[user.companyId] = (counts[user.companyId] ?? 0) + 1;
    }
    return counts;
  }, {});
  const activePlatformOwners = users.filter((user) => user.active
    && Boolean(user.accountSetupCompletedAt)
    && (user.isOwner || user.role === "PLATFORM_OWNER")).length;
  const showOrganization = actor.accountKind === "PLATFORM" || actor.isOwner;

  return <><PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} />
    <section className="detail-grid">
      <article className="panel form-panel"><h2>{copy.create}</h2>
        <UserCreateForm
          actorBranchId={actor.branchId}
          actorCompanyId={actor.companyId}
          actorDepartmentId={actor.departmentId}
          actorIsOwner={actor.isOwner}
          defaultLocale={actor.preferredLocale ?? "en"}
          branches={branches}
          companies={companies}
          departments={structure.departments}
          permissionOptions={permissionOptions}
          roleOptions={availableRoles.map((role) => ({
            value: role.key,
            label: role.label,
            description: role.description,
            category: role.category,
            accountKind: role.accountKind,
            allowedScopes: role.allowedScopes,
            defaultPermissions: defaultPermissionsForRole(
              role.key,
              role.allowedScopes[0],
              role.key === "PLATFORM_OWNER",
            ),
          }))}
        />
      </article>
      <aside className="panel"><div className="panel-header"><div><h2>{copy.smallestRole}</h2><p>{copy.smallestRoleBody}</p></div></div>
        <div className="panel-body"><div className="callout"><strong>{copy.requesterRole}</strong><p>{copy.requesterBody}</p></div>
          <div className="callout"><strong>{copy.approverRole}</strong><p>{copy.approverBody}</p></div>
          <div className="callout"><strong>{copy.branchAdminRole}</strong><p>{copy.branchAdminBody}</p></div>
          <div className="callout"><strong>{copy.companyAdminRole}</strong><p>{copy.companyAdminBody}</p></div></div>
      </aside>
    </section>

    <section className="panel" style={{ marginBlockStart: 17 }}><div className="data-table-wrap"><table className="data-table"><thead><tr>
      <th>{copy.user}</th>{showOrganization ? <th>{copy.organization}</th> : null}<th>{copy.role}</th><th>{copy.scope}</th><th>{common.status}</th><th>{copy.lastLogin}</th><th>{copy.action}</th>
    </tr></thead><tbody>{users.map((user) => {
      const isPlatformOwner = user.isOwner || user.role === "PLATFORM_OWNER";
      const isCompanyAdmin = ["ADMIN", "COMPANY_ADMIN"].includes(user.role);
      const protectedLabel = user.id === actor.id ? copy.currentSession
        : user.active && Boolean(user.accountSetupCompletedAt)
          && isPlatformOwner && activePlatformOwners <= 1 ? copy.lastOwner
          : user.active && Boolean(user.accountSetupCompletedAt) && isCompanyAdmin
            && Boolean(user.companyId) && activeAdminCounts[user.companyId!] <= 1
            ? copy.lastAdmin : "";
      const setupPending = user.active && !user.accountSetupCompletedAt;
      const canResend = setupPending;
      const canOpenAccess = user.active && Boolean(user.accountSetupCompletedAt);
      const organizationName = user.companyName ?? user.supplierName
        ?? (user.accountKind === "DELIVERY" ? copy.deliveryNetwork : copy.platform);
      const scope = user.scopeType === "PLATFORM" ? copy.platformWide
        : user.scopeType === "DELIVERY" ? copy.assignedDeliveries
          : user.departmentName ?? user.supplierName ?? user.branchName
            ?? user.companyName ?? copy.companyWide;
      return <tr key={user.id}>
        <td><div className="profile-user-cell"><UserAvatar name={user.displayName} size={40} userId={user.avatarAvailable ? user.id : undefined} /><div><strong>{user.displayName}</strong>{user.jobTitle ? ` · ${user.jobTitle}` : ""}<br /><span className="subtle">{user.email}</span></div></div></td>
        {showOrganization ? <td>{organizationName}</td> : null}
        <td>{localizedAccountRole(user.role, locale)?.label ?? accountRoleLabel(user.role)}</td>
        <td>{scope}</td>
        <td><StatusBadge status={invitationStatus(user)}>{localizedStatus(invitationStatus(user), locale)}</StatusBadge></td>
        <td>{setupPending ? <span className="subtle">{invitationTimeline(user, locale, timeZone, copy)}</span> : formatDateTime(user.lastLoginAt, locale, timeZone)}</td>
        <td><div className="action-row">
          {canOpenAccess ? <Link className="button button-secondary" href={`/users/${user.id}/access`}>{accessCopy.openAccess}</Link> : null}
          {protectedLabel ? <span className="subtle">{protectedLabel}</span> : <>
            {canResend ? <InvitationResendForm userId={user.id}
              userName={user.displayName} locale={locale} /> : null}
            <form action={setUserActiveAction.bind(null, user.id, !user.active)}>
              <button className="button button-secondary" type="submit">{user.active ? copy.deactivate : copy.reactivate}</button>
            </form>
            {user.avatarAvailable ? <form action={deactivateUserProfileImageAction.bind(null, user.id)}>
              <button className="text-button" type="submit" aria-label={imageCopy.removeFor(user.displayName)}>{imageCopy.remove}</button>
            </form> : null}
          </>}
        </div></td>
      </tr>;
    })}</tbody></table></div></section>
  </>;
}
