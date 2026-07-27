import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { UserCreateForm } from "@/components/UserCreateForm";
import { requirePagePermission } from "@/lib/auth";
import { formatDate } from "@/lib/domain";
import { listBranches, listCompanies } from "@/lib/repository";
import type { UserRole } from "@/lib/types";
import { listUsers } from "@/lib/users";
import { setUserActiveAction } from "./actions";

const roleLabels: Record<UserRole, string> = {
  ADMIN: "Company administrator",
  BRANCH_ADMIN: "Branch administrator",
  APPROVER: "Branch approver (HR / manager / CEO)",
  REQUESTER: "Purchase requester",
  OPERATIONS: "Legacy operations",
  FINANCE: "Finance viewer",
  VIEWER: "Read-only auditor",
  IT_SUPPORT: "Technical support",
};

export default async function UsersPage() {
  const actor = await requirePagePermission("manage_users");
  const [users, companies, branches] = await Promise.all([listUsers(actor), actor.isOwner ? listCompanies(actor) : Promise.resolve([]), listBranches(actor)]);
  const activeAdminCounts = users.reduce<Record<string, number>>((counts, user) => {
    if (user.active && user.role === "ADMIN" && user.companyId) counts[user.companyId] = (counts[user.companyId] ?? 0) + 1;
    return counts;
  }, {});
  const availableRoles: UserRole[] = actor.role === "BRANCH_ADMIN"
    ? ["REQUESTER", "APPROVER"]
    : actor.isOwner
      ? ["ADMIN", "BRANCH_ADMIN", "APPROVER", "REQUESTER", "FINANCE", "VIEWER", "IT_SUPPORT"]
      : ["ADMIN", "BRANCH_ADMIN", "APPROVER", "REQUESTER", "FINANCE", "VIEWER"];

  return <><PageHeader eyebrow="People & access" title="Create named accounts"
    description="Role controls what a person can do. Branch assignment controls where they can do it. Never share an administrator account." />
    <section className="detail-grid">
      <article className="panel form-panel"><h2>Create account</h2>
        <UserCreateForm
          actorBranchId={actor.branchId}
          actorCompanyId={actor.companyId}
          actorIsOwner={actor.isOwner}
          branches={branches}
          companies={companies}
          roleOptions={availableRoles.map((role) => ({ value: role, label: roleLabels[role] }))}
        />
      </article>
      <aside className="panel"><div className="panel-header"><div><h2>Choose the smallest role</h2><p>Clear responsibility prevents mistakes</p></div></div>
        <div className="panel-body"><div className="callout"><strong>Requester</strong><p>Creates purchase requests for one branch.</p></div>
          <div className="callout"><strong>Approver</strong><p>Assign this to the branch&apos;s authorised HR lead, manager, CEO, or another person who may approve requests against its budget.</p></div>
          <div className="callout"><strong>Branch administrator</strong><p>Manages requesters and approvers for one branch.</p></div>
          <div className="callout"><strong>Company administrator</strong><p>Manages every branch, budget and company user.</p></div></div>
      </aside>
    </section>

    <section className="panel" style={{ marginTop: 17 }}><div className="data-table-wrap"><table className="data-table"><thead><tr>
      <th>User</th>{actor.isOwner ? <th>Company</th> : null}<th>Role</th><th>Access scope</th><th>Status</th><th>Last login</th><th>Action</th>
    </tr></thead><tbody>{users.map((user) => {
      const protectedLabel = user.isOwner ? "Owner protected" : user.id === actor.id ? "Current session"
        : user.active && user.role === "ADMIN" && Boolean(user.companyId) && activeAdminCounts[user.companyId!] <= 1 ? "Last company admin" : "";
      return <tr key={user.id}>
        <td><strong>{user.displayName}</strong>{user.isOwner ? " · Platform owner" : ""}<br /><span className="subtle">{user.email}</span></td>
        {actor.isOwner ? <td>{user.companyName || "Axora platform"}</td> : null}
        <td>{user.isOwner ? "Platform owner" : roleLabels[user.role]}</td>
        <td>{user.isOwner ? "All companies" : user.branchName ?? "Entire company"}</td>
        <td><StatusBadge>{user.active ? "Active" : "Inactive"}</StatusBadge></td>
        <td>{formatDate(user.lastLoginAt)}</td>
        <td>{protectedLabel ? <span className="subtle">{protectedLabel}</span> : <form action={setUserActiveAction.bind(null, user.id, !user.active)}>
          <button className="button button-secondary" type="submit">{user.active ? "Deactivate" : "Reactivate"}</button>
        </form>}</td>
      </tr>;
    })}</tbody></table></div></section>
  </>;
}
