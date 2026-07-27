import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatDate } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { listDeliveries } from "@/lib/operations";
import { listRequests } from "@/lib/repository";
import { recordDeliveryAction } from "../operations/actions";

const deliveryStatuses = ["Scheduled", "Preparing", "Out for Delivery", "Partially Delivered", "Delivered", "Delayed", "Failed", "Cancelled"];

export default async function DeliveriesPage() {
  const actor = await requirePagePermission("view_deliveries");
  const canManage = canAccess(actor, "manage_deliveries");
  const [requests, deliveries] = await Promise.all([listRequests(), listDeliveries()]);
  const lines = requests.filter((request) => ["Ordered", "Preparing for Delivery", "Out for Delivery"].includes(request.status))
    .flatMap((request) => request.lines.map((line) => ({ ...line, orderCode: request.orderCode, companyName: request.companyName })));
  return <><PageHeader eyebrow="Receiving control" title="Deliveries" description="Create one record for every shipment. Only accepted partial or full deliveries increase the received quantity." />
    {canManage ? <section className="panel form-panel"><h2>Add a delivery update</h2><p>For Partially Delivered or Delivered, enter the accepted quantity, actual date and receiver. Every other status must keep received quantity at zero.</p><form action={recordDeliveryAction}><div className="form-grid">
      <label className="field-full">Request line<select name="requestLineId" required defaultValue=""><option value="" disabled>Select line</option>{lines.map((line) => <option key={line.id} value={line.id}>{line.orderCode} · {line.companyName} · {line.productName} ({line.quantity} {line.unit})</option>)}</select></label>
      <label>Status<select name="status" defaultValue="Scheduled">{deliveryStatuses.map((status) => <option key={status}>{status}</option>)}</select></label><label>Quantity received now<input name="quantityReceived" type="number" min="0" step="0.01" defaultValue="0" required /></label>
      <label>Expected date<input name="expectedDate" type="date" /></label><label>Revised date<input name="revisedDate" type="date" /></label><label>Actual date<input name="actualDate" type="date" /></label><label>Received by<input name="receivedBy" placeholder="Employee name" /></label>
      <label className="field-full">Delay / issue reason<textarea name="issueReason" placeholder="Required for delayed, failed, or cancelled delivery" /></label>
    </div><div className="form-actions"><button className="button button-primary" type="submit">Save delivery update</button></div></form></section> : null}
    <section className="panel" style={{ marginTop: canManage ? 17 : 0 }}><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Request line</th><th>Company / product</th><th>Status</th><th>Expected</th><th>Actual</th><th>Received now</th><th>Receiver / issue</th></tr></thead><tbody>{deliveries.map((item) => <tr key={item.id}><td><strong>{item.orderCode}</strong><br /><span className="subtle">{item.requestLineCode}</span></td><td>{item.companyName}<br /><span className="subtle">{item.productName}</span></td><td><StatusBadge>{item.status}</StatusBadge></td><td>{formatDate(item.revisedDate || item.expectedDate)}</td><td>{formatDate(item.actualDate)}</td><td>{item.quantityReceived}</td><td>{item.receivedBy || "—"}<br /><span className="subtle">{item.issueReason}</span></td></tr>)}</tbody></table></div></section>
  </>;
}
