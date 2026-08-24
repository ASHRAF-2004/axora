import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { UserAvatar } from "@/components/UserAvatar";
import { requirePagePermission } from "@/lib/auth";
import { loadOrganizationDirectory } from "@/lib/organization-access";
import { accountRoleLabel } from "@/lib/role-catalog";
import { localizedAccountRole } from "@/lib/user-form-i18n";
import { listAuthorizedUsers } from "@/lib/user-isolation";

const messages = {
  en: { eyebrow: "Branch people", title: (name: string) => `${name} people`, description: "People whose active access is assigned to this branch.", back: "Back to branch", empty: "No people are assigned to this branch yet.", user: "Person", role: "Role", status: "Status", action: "Action", access: "Manage access", active: "Active", pending: "Invitation pending", inactive: "Inactive" },
  ar: { eyebrow: "أشخاص الفرع", title: (name: string) => `أشخاص ${name}`, description: "الأشخاص الذين تم تعيين وصولهم النشط إلى هذا الفرع.", back: "العودة إلى الفرع", empty: "لم يتم تعيين أشخاص لهذا الفرع بعد.", user: "الشخص", role: "الدور", status: "الحالة", action: "الإجراء", access: "إدارة الوصول", active: "نشط", pending: "الدعوة معلقة", inactive: "غير نشط" },
  ms: { eyebrow: "Orang cawangan", title: (name: string) => `Orang ${name}`, description: "Orang dengan akses aktif yang ditugaskan kepada cawangan ini.", back: "Kembali ke cawangan", empty: "Belum ada orang ditugaskan kepada cawangan ini.", user: "Orang", role: "Peranan", status: "Status", action: "Tindakan", access: "Urus akses", active: "Aktif", pending: "Jemputan belum selesai", inactive: "Tidak aktif" },
} as const;

export default async function BranchPeoplePage({
  params,
}: {
  params: Promise<{ branchId: string }>;
}) {
  const actor = await requirePagePermission("manage_users");
  if (actor.accountKind !== "COMPANY") redirect("/access-denied");
  const locale = actor.preferredLocale ?? "en";
  const copy = messages[locale];
  const { branchId } = await params;
  const [organization, users] = await Promise.all([
    loadOrganizationDirectory(actor),
    listAuthorizedUsers(actor),
  ]);
  const branch = organization.branches.find((candidate) => candidate.id === branchId);
  if (!branch) notFound();
  const assigned = users.filter((user) => (
    user.companyId === branch.companyId
    && user.branchId === branch.id
    && user.accountStatus !== "DEACTIVATED"
  ));

  return <>
    <PageHeader eyebrow={copy.eyebrow} title={copy.title(branch.name)} description={copy.description} />
    <div className="page-actions"><Link className="button button-secondary" href={`/branches/${branch.id}`}>{copy.back}</Link></div>
    <section className="panel">
      {assigned.length ? <div className="data-table-wrap"><table className="data-table">
        <thead><tr><th>{copy.user}</th><th>{copy.role}</th><th>{copy.status}</th><th>{copy.action}</th></tr></thead>
        <tbody>{assigned.map((user) => {
          const status = !user.active ? copy.inactive
            : user.accountSetupCompletedAt ? copy.active : copy.pending;
          return <tr key={user.id}>
            <td><div className="profile-user-cell"><UserAvatar name={user.displayName} size={40} userId={user.avatarAvailable ? user.id : undefined} /><div><strong>{user.displayName}</strong><br /><span className="subtle">{user.email}</span></div></div></td>
            <td>{localizedAccountRole(user.role, locale)?.label ?? accountRoleLabel(user.role)}</td>
            <td><StatusBadge status={status}>{status}</StatusBadge></td>
            <td><Link className="button button-secondary" href={`/users/${user.id}/access`}>{copy.access}</Link></td>
          </tr>;
        })}</tbody>
      </table></div> : <p>{copy.empty}</p>}
    </section>
  </>;
}
