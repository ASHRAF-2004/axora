import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { loadAuthorizedDocumentRegisters } from "@/lib/document-register-isolation";
import { formatDateTime } from "@/lib/domain";
import { canAccess } from "@/lib/permissions";
import { FileCheck2, Upload } from "lucide-react";
import { uploadAttachmentAction } from "./actions";
import { operationalMessage, type OperationalMessageKey } from "@/lib/operational-i18n";

export default async function DocumentsPage() {
  const actor = await requirePagePermission("view_documents");
  const locale = actor.preferredLocale ?? "en";
  const m = (key: OperationalMessageKey, values?: Record<string, string | number>) => operationalMessage(locale, key, values);
  const canManage = canAccess(actor, "manage_documents");
  const platformView = actor.isOwner || actor.accountKind === "PLATFORM";
  const { requests, invoices, deliveries, attachments } =
    await loadAuthorizedDocumentRegisters(actor);
  const targets = [
    ...requests.map((item) => ({ type: "request", id: item.id, label: `${item.orderCode} · ${m("documents.requestSuffix")}` })),
    ...invoices.map((item) => ({ type: "invoice", id: item.id, label: `${item.invoiceNumber} · ${m("documents.invoiceSuffix")}` })),
    ...deliveries.map((item) => ({ type: "delivery", id: item.id, label: `${item.orderCode} · ${item.productName} · ${m("documents.deliverySuffix")}` })),
  ];
  return <><PageHeader eyebrow={m("documents.eyebrow")} title={m("documents.title")} description={m(platformView ? "documents.platformDescription" : "documents.companyDescription")} />
    {canManage ? <section className="detail-grid"><article className="panel form-panel"><h2>{m("documents.upload")}</h2><form action={uploadAttachmentAction}><div className="form-grid">
      <label>{m("documents.recordType")}<select name="entityType" defaultValue="request"><option value="request">{m("documents.request")}</option><option value="invoice">{m("documents.invoice")}</option><option value="delivery">{m("documents.delivery")}</option></select></label>
      <label>{m("documents.linked")}<select name="recordId" required defaultValue=""><option value="" disabled>{m("documents.select")}</option>{targets.map((item) => <option key={`${item.type}-${item.id}`} value={item.id}>{item.label}</option>)}</select></label>
      {platformView ? <label className="field-full">{m("documents.visibility")}<select name="visibility" defaultValue="INTERNAL">
        <option value="INTERNAL">{m("documents.internal")}</option>
        <option value="CUSTOMER">{m("documents.customer")}</option>
      </select><small>{m("documents.visibilityHelp")}</small></label> : null}
      <label className="field-full">{m("documents.file")}<input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.txt,.csv" /></label>
    </div><div className="form-actions"><button className="button button-primary" type="submit"><Upload size={16} />{m("documents.uploadButton")}</button></div></form></article>
      <aside className="panel"><div className="panel-header"><div><h2>{m("documents.safety")}</h2><p>{m("documents.safetyIntro")}</p></div><FileCheck2 /></div><div className="panel-body"><div className="callout"><strong>{m("documents.max")}</strong><p>{m("documents.allowed")}</p></div></div></aside>
    </section> : null}<section className="panel" style={{ marginTop: canManage ? 17 : 0 }}><div className="data-table-wrap"><table className="data-table"><thead><tr><th>{m("documents.fileColumn")}</th><th>{m("documents.type")}</th>{platformView ? <th>{m("documents.visibilityColumn")}</th> : null}<th>{m("documents.record")}</th><th>{m("documents.uploaded")}</th><th>{m("documents.by")}</th></tr></thead><tbody>{attachments.map((item) => <tr key={item.id}><td><a className="table-link" href={`/api/attachments/${item.id}`}>{item.fileName}</a><br /><span className="subtle">{item.contentType}</span></td><td>{item.entityType}</td>{platformView ? <td>{m(item.visibility === "INTERNAL" ? "documents.internalShort" : "documents.shared")}</td> : null}<td>{item.recordId}</td><td>{formatDateTime(item.createdAt, locale, actor.timezone)}</td><td>{item.uploadedByName || "—"}</td></tr>)}</tbody></table></div></section>
  </>;
}
