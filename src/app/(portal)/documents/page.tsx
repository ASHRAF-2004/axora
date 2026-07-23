import { PageHeader } from "@/components/PageHeader";
import { requireSession } from "@/lib/auth";
import { formatDate } from "@/lib/domain";
import { hasPermission } from "@/lib/permissions";
import { listAttachments, listDeliveries, listInvoices } from "@/lib/operations";
import { listRequests } from "@/lib/repository";
import { FileCheck2, Upload } from "lucide-react";
import { uploadAttachmentAction } from "../operations/actions";

export default async function DocumentsPage() {
  const actor = await requireSession();
  const canManage = hasPermission(actor.role, "manage_documents");
  const [requests, invoices, deliveries, attachments] = await Promise.all([listRequests(), listInvoices(), listDeliveries(), listAttachments()]);
  const targets = [
    ...requests.map((item) => ({ type: "request", id: item.id, label: `${item.orderCode} · request` })),
    ...invoices.map((item) => ({ type: "invoice", id: item.id, label: `${item.invoiceNumber} · invoice` })),
    ...deliveries.map((item) => ({ type: "delivery", id: item.id, label: `${item.orderCode} · ${item.productName} · delivery` })),
  ];
  return <><PageHeader eyebrow="Evidence storage" title="Documents" description="Attach quotation, invoice, delivery, or supporting files to an existing company record." />
    {canManage ? <section className="detail-grid"><article className="panel form-panel"><h2>Upload a document</h2><form action={uploadAttachmentAction}><div className="form-grid">
      <label>Record type<select name="entityType" defaultValue="request"><option value="request">Request</option><option value="invoice">Invoice</option><option value="delivery">Delivery</option></select></label>
      <label>Linked record<select name="recordId" required defaultValue=""><option value="" disabled>Select record</option>{targets.map((item) => <option key={`${item.type}-${item.id}`} value={item.id}>{item.label}</option>)}</select></label>
      <label className="field-full">File<input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.txt,.csv" /></label>
    </div><div className="form-actions"><button className="button button-primary" type="submit"><Upload size={16} />Upload</button></div></form></article>
      <aside className="panel"><div className="panel-header"><div><h2>Safety limits</h2><p>Rules for secure document storage</p></div><FileCheck2 /></div><div className="panel-body"><div className="callout"><strong>Maximum 2 MB per file.</strong><p>Allowed: PDF, PNG, JPG, TXT, and CSV. Do not upload passwords, executable files, or unrelated personal data.</p></div></div></aside>
    </section> : null}<section className="panel" style={{ marginTop: canManage ? 17 : 0 }}><div className="data-table-wrap"><table className="data-table"><thead><tr><th>File</th><th>Type</th><th>Linked record</th><th>Uploaded</th><th>Uploaded by</th></tr></thead><tbody>{attachments.map((item) => <tr key={item.id}><td><a className="table-link" href={`/api/attachments/${item.id}`}>{item.fileName}</a><br /><span className="subtle">{item.contentType}</span></td><td>{item.entityType}</td><td>{item.recordId}</td><td>{formatDate(item.createdAt)}</td><td>{item.uploadedByName || "—"}</td></tr>)}</tbody></table></div></section>
  </>;
}
