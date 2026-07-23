import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatDate } from "@/lib/domain";
import { listUsers } from "@/lib/users";
import { createUserAction, setUserActiveAction } from "./actions";

export default async function UsersPage() {
  const users = await listUsers();
  return <><PageHeader eyebrow="Access control" title="Users and roles" description="Give each person only the access needed for their job. Never share one administrator password." />
    <section className="detail-grid"><article className="panel form-panel"><h2>Create user</h2><form action={createUserAction}><div className="form-grid">
      <label>Name<input name="displayName" required /></label><label>Email<input name="email" type="email" required /></label>
      <label>Role<select name="role" defaultValue="VIEWER"><option value="ADMIN">Admin / supervisor</option><option value="OPERATIONS">Operations</option><option value="FINANCE">Finance</option><option value="VIEWER">Viewer</option><option value="IT_SUPPORT">IT support</option></select></label>
      <label>Temporary password<input name="password" type="password" minLength={14} required autoComplete="new-password" /></label>
    </div><div className="form-actions"><button className="button button-primary" type="submit">Create account</button></div></form></article>
      <aside className="panel"><div className="panel-header"><div><h2>Role rule</h2><p>Start with the smallest permission</p></div></div><div className="panel-body"><div className="callout"><strong>Viewer is the safest default.</strong><p>Operations may change requests and sourcing. Finance may manage invoices and payments. Only Admin creates users.</p></div></div></aside>
    </section><section className="panel" style={{ marginTop: 17 }}><div className="data-table-wrap"><table className="data-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last login</th><th>Action</th></tr></thead><tbody>{users.map((user) => <tr key={user.id}><td><strong>{user.displayName}</strong><br /><span className="subtle">{user.email}</span></td><td>{user.role.replace("_", " ")}</td><td><StatusBadge>{user.active ? "Active" : "Inactive"}</StatusBadge></td><td>{formatDate(user.lastLoginAt)}</td><td><form action={setUserActiveAction.bind(null, user.id, !user.active)}><button className="button button-secondary" type="submit">{user.active ? "Deactivate" : "Activate"}</button></form></td></tr>)}</tbody></table></div></section>
  </>;
}
