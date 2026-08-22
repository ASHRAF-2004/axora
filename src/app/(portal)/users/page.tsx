import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { UserAvatar } from "@/components/UserAvatar";
import { InvitationResendForm } from "@/components/InvitationResendForm";
import { accessAdministrationMessages } from "@/lib/access-administration-i18n";
import { requirePagePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/domain";
import { corePortalMessages, localizedStatus } from "@/lib/core-portal-i18n";
import type { SupportedLocale } from "@/lib/i18n";
import { localizedAccountRole } from "@/lib/user-form-i18n";
import { accountRoleLabel } from "@/lib/role-catalog";
import { listAuthorizedUsers } from "@/lib/user-isolation";
import { profileImageMessages } from "@/lib/profile-image-i18n";
import { peopleWorkspaceMessages } from "@/lib/people-workspaces-i18n";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  setUserActiveAction,
  deactivateUserProfileImageAction,
  removeUserAction,
} from "./actions";

const permanentDeletionMessages = {
  en: {
    label: "Permanently delete user",
    help: "This permanently erases the user’s sign-in identity, email, password, sessions, profile, invitations, preferences and profile images. The original email can be registered again as a completely new account. Required business and audit records retain only an anonymous historical reference.",
    confirm: "I understand that this personal account deletion cannot be undone.",
    removedNotice: "The user’s personal account data was permanently deleted. Their previous email can now be registered as a new account.",
  },
  ar: {
    label: "حذف المستخدم نهائيًا",
    help: "سيؤدي هذا إلى محو هوية تسجيل الدخول والبريد الإلكتروني وكلمة المرور والجلسات والملف الشخصي والدعوات والتفضيلات وصور الملف نهائيًا. يمكن تسجيل البريد السابق لاحقًا كحساب جديد مستقل تمامًا. تحتفظ سجلات الأعمال والتدقيق المطلوبة بمرجع تاريخي مجهول فقط.",
    confirm: "أفهم أن حذف بيانات هذا الحساب نهائي ولا يمكن التراجع عنه.",
    removedNotice: "تم حذف بيانات حساب المستخدم الشخصية نهائيًا، وأصبح بريده السابق متاحًا للتسجيل كحساب جديد.",
  },
  ms: {
    label: "Padam pengguna secara kekal",
    help: "Tindakan ini memadam secara kekal identiti log masuk, e-mel, kata laluan, sesi, profil, jemputan, keutamaan dan imej profil pengguna. E-mel asal boleh didaftarkan semula sebagai akaun baharu yang berasingan sepenuhnya. Rekod perniagaan dan audit yang diperlukan hanya mengekalkan rujukan sejarah tanpa identiti.",
    confirm: "Saya faham bahawa pemadaman data akaun peribadi ini tidak boleh dibatalkan.",
    removedNotice: "Data akaun peribadi pengguna telah dipadam secara kekal. E-mel lama mereka kini boleh didaftarkan sebagai akaun baharu.",
  },
} as const;

function invitationStatus(user: Awaited<ReturnType<typeof listAuthorizedUsers>>[number]) {
  if (user.accountStatus === "DEACTIVATED") return "Removed";
  if (!user.active) return "Inactive";
  if (user.accountSetupCompletedAt) return "Active";
  if (user.accountSetupExpiresAt && new Date(user.accountSetupExpiresAt).getTime() <= Date.now()) return "Invite expired";
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
  if (user.accountSetupDeliveryStatus === "UNCERTAIN") return copy.deliveryUnknown;
  if (user.accountSetupDeliveryStatus === "DISABLED") return copy.deliveryNotConfigured;
  if (user.accountSetupExpiresAt) return copy.expiresAt(formatDateTime(user.accountSetupExpiresAt, locale, timeZone));
  return copy.neverSignedIn;
}

export default async function UsersPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const actor = await requirePagePermission("manage_users");
  if (actor.accountKind !== "PLATFORM") notFound();
  const locale = actor.preferredLocale ?? "en";
  const timeZone = actor.timezone ?? "Asia/Kuala_Lumpur";
  const portalCopy = corePortalMessages(locale);
  const copy = portalCopy.users;
  const common = portalCopy.common;
  const accessCopy = accessAdministrationMessages(locale);
  const imageCopy = profileImageMessages(locale);
  const deletionCopy = permanentDeletionMessages[locale];
  const workspaceCopy = peopleWorkspaceMessages(locale);
  const [directoryUsers, params] = await Promise.all([listAuthorizedUsers(actor), searchParams]);
  const users = directoryUsers.filter((user) => (
    user.accountKind === "PLATFORM" && user.accountStatus !== "DEACTIVATED"
  ));
  const standardNotice = params.notice ? portalCopy.notices[params.notice] : undefined;
  const localNotice = params.notice === "user-removed"
    ? { message: deletionCopy.removedNotice }
    : params.notice === "remove-unavailable"
      ? { message: copy.removeUnavailable, tone: "error" as const }
      : params.notice === "user-creation-invalid"
        ? { message: workspaceCopy.invalidUser, tone: "error" as const }
        : params.notice === "user-permission-selection-unavailable"
          ? { message: workspaceCopy.unavailablePermissions, tone: "error" as const }
          : undefined;
  const notice = standardNotice ?? localNotice;
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

  return <><PageHeader eyebrow={workspaceCopy.axoraEyebrow} title={workspaceCopy.axoraTitle} description={workspaceCopy.axoraDescription} />
    {actor.isOwner ? <div className="page-actions"><Link className="button button-primary" href="/users/new">{workspaceCopy.createAxora}</Link></div> : null}
    {notice ? <div className={notice.tone === "error" ? "form-alert" : "callout"} role={notice.tone === "error" ? "alert" : "status"}><strong>{notice.message}</strong></div> : null}
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
      // Prompt 5 makes the same management workspace available before setup is
      // complete and for suspended accounts. Mutation capabilities still fail
      // closed at the server/database boundary.
      const canOpenAccess = user.accountStatus !== "DEACTIVATED";
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
            {canResend ? <InvitationResendForm userId={user.id} userName={user.displayName} locale={locale} /> : null}
            <form action={setUserActiveAction.bind(null, user.id, !user.active)}>
              <button className="button button-secondary" type="submit">{user.active ? copy.deactivate : copy.reactivate}</button>
            </form>
            {actor.isOwner && !isPlatformOwner ? <details>
              <summary>{deletionCopy.label}</summary>
              <form action={removeUserAction.bind(null, user.id)} className="table-action-stack">
                <p className="subtle">{deletionCopy.help}</p>
                <label><input type="checkbox" name="confirmRemoval" value="confirmed" required /> {deletionCopy.confirm}</label>
                <button className="button button-secondary" type="submit">{deletionCopy.label}</button>
              </form>
            </details> : null}
            {user.avatarAvailable ? <form action={deactivateUserProfileImageAction.bind(null, user.id)}>
              <button className="text-button" type="submit" aria-label={imageCopy.removeFor(user.displayName)}>{imageCopy.remove}</button>
            </form> : null}
          </>}
        </div></td>
      </tr>;
    })}</tbody></table></div></section>
  </>;
}
