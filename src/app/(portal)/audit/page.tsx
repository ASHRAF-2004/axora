import { PageHeader } from "@/components/PageHeader";
import { formatDate } from "@/lib/domain";
import { listAuditRecords } from "@/lib/operations";

export default async function AuditPage() {
  const records = await listAuditRecords();
  return <><PageHeader eyebrow="Accountability" title="Audit history" description="A read-only view of important database changes, who made them, and the recorded reason." />
    <section className="panel"><div className="panel-header"><div><h2>Recent changes</h2><p>Up to 500 newest records</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>When</th><th>Entity</th><th>Action</th><th>Record</th><th>User</th><th>Reason</th></tr></thead><tbody>{records.length ? records.map((item) => <tr key={item.id}><td>{formatDate(item.occurredAt)}</td><td>{item.entityType}</td><td>{item.action}</td><td><span className="subtle">{item.recordId || "—"}</span></td><td>{item.actorName || "System / migration"}</td><td>{item.reason || "—"}</td></tr>) : <tr><td colSpan={6}>No changes have been recorded in this session yet.</td></tr>}</tbody></table></div></section>
  </>;
}
