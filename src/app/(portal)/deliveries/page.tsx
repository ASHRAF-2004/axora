import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { loadAuthorizedDeliveryRegisters } from "@/lib/delivery-isolation";
import { formatDate, formatDateTime } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { listDeliveryAgents, listDeliveryJobs } from "@/lib/delivery-admin";
import { randomUUID } from "node:crypto";
import { assignDeliveryDriverAction, createDeliveryJobAction } from "./actions";
import { operationalMessage, operationalNumber, operationalStatus, type OperationalMessageKey } from "@/lib/operational-i18n";

export default async function DeliveriesPage() {
  const actor = await requirePagePermission("view_deliveries");
  const locale = actor.preferredLocale ?? "en";
  const m = (key: OperationalMessageKey, values?: Record<string, string | number>) => operationalMessage(locale, key, values);
  const canManage = canAccess(actor, "manage_deliveries");
  const [delivery, jobs, drivers] = await Promise.all([
    loadAuthorizedDeliveryRegisters(actor),
    canManage ? listDeliveryJobs(actor) : Promise.resolve([]),
    canManage ? listDeliveryAgents(actor) : Promise.resolve([]),
  ]);
  const { requests, deliveries } = delivery;
  const eligibleRequests = requests.filter((request) =>
    ["Supplier Assigned", "Ordered", "Preparing for Delivery", "Out for Delivery"].includes(request.status)
      && request.approvalStatus === "Approved");
  return <><PageHeader eyebrow={m("deliveries.eyebrow")} title={m("deliveries.title")} description={m(canManage ? "deliveries.manageDescription" : "deliveries.viewDescription")} />
    {canManage ? <>
      <section className="panel form-panel"><h2>{m("deliveries.create")}</h2><p>{m("deliveries.createIntro")}</p><form action={createDeliveryJobAction}>
        <input type="hidden" name="idempotencyKey" value={randomUUID()} />
        <div className="form-grid">
          <label className="field-full">{m("deliveries.request")}<select name="requestId" required defaultValue=""><option value="" disabled>{m("deliveries.selectRequest")}</option>{eligibleRequests.map((request) => <option key={request.id} value={request.id}>{request.orderCode} · {request.companyName} · {request.branchName}</option>)}</select></label>
          <label>{m("deliveries.starts")}<input name="windowStart" type="datetime-local" /></label>
          <label>{m("deliveries.ends")}<input name="windowEnd" type="datetime-local" /></label>
          <label className="field-full">{m("deliveries.instructions")}<textarea name="instructions" maxLength={2000} placeholder={m("deliveries.instructionsPlaceholder")} /></label>
        </div><div className="form-actions"><button className="button button-primary" type="submit">{m("deliveries.submit")}</button></div>
      </form></section>

      <section className="panel" style={{ marginTop: 17 }}><div className="panel-header"><div><h2>{m("deliveries.jobs")}</h2><p>{m("deliveries.count", { count: operationalNumber(locale, jobs.length) })}</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>{m("deliveries.jobRequest")}</th><th>{m("deliveries.destination")}</th><th>{m("deliveries.packages")}</th><th>{m("deliveries.window")}</th><th>{m("common.status")}</th><th>{m("deliveries.driver")}</th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}>
        <td><strong>{job.jobCode}</strong><br /><span className="subtle">{job.orderCode} · {job.companyName}</span></td>
        <td>{job.branchName}</td><td>{job.packageSummary}</td>
        <td>{formatDateTime(job.windowStart, locale, actor.timezone)}<br /><span className="subtle">{m("deliveries.to", { date: formatDateTime(job.windowEnd, locale, actor.timezone) })}</span></td>
        <td><StatusBadge>{operationalStatus(locale, job.lastEvent ?? job.status)}</StatusBadge>{job.lastEventAt ? <><br /><span className="subtle">{formatDateTime(job.lastEventAt, locale, actor.timezone)}</span></> : null}</td>
        <td>{job.driverName ? <><strong>{job.driverName}</strong><br /><span className="subtle">{operationalStatus(locale, job.assignmentStatus ?? job.status)}</span></> : <form action={assignDeliveryDriverAction} className="inline-assignment-form"><input type="hidden" name="deliveryJobId" value={job.id} /><select name="driverUserId" required defaultValue=""><option value="" disabled>{m("deliveries.chooseDriver")}</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.name}</option>)}</select><button className="button button-secondary" type="submit">{m("deliveries.assign")}</button></form>}</td>
      </tr>)}</tbody></table></div></section>
    </> : null}
    <section className="panel" style={{ marginTop: 17 }}><div className="panel-header"><div><h2>{m("deliveries.history")}</h2><p>{m("deliveries.historyIntro")}</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>{m("deliveries.requestLine")}</th><th>{m("deliveries.companyProduct")}</th><th>{m("common.status")}</th><th>{m("deliveries.expected")}</th><th>{m("deliveries.actual")}</th><th>{m("deliveries.evidenceQuantity")}</th><th>{m("deliveries.evidenceIssue")}</th></tr></thead><tbody>{deliveries.map((item) => <tr key={item.id}><td><strong>{item.orderCode}</strong><br /><span className="subtle">{item.requestLineCode}</span></td><td>{item.companyName}<br /><span className="subtle">{item.productName}</span></td><td><StatusBadge>{operationalStatus(locale, item.status)}</StatusBadge></td><td>{formatDate(item.revisedDate || item.expectedDate, locale, actor.timezone)}</td><td>{formatDate(item.actualDate, locale, actor.timezone)}</td><td>{operationalNumber(locale, item.quantityReceived)}</td><td>{item.receivedBy || "—"}<br /><span className="subtle">{item.issueReason}</span></td></tr>)}</tbody></table></div></section>
  </>;
}
