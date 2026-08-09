import { randomUUID } from "node:crypto";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  formatGeneratedDocumentDate,
  formatGeneratedDocumentNumber,
  generatedDocumentMessages,
  localizedGeneratedDocumentJobStatus,
} from "@/lib/generated-documents-i18n";
import { getGeneratedDocumentWorkspace } from "@/lib/generated-documents";
import {
  manageSupplierPurchaseOrderAction,
  regenerateGeneratedDocumentAction,
} from "@/lib/generated-document-actions";
import { StatusBadge } from "./StatusBadge";
import {
  GeneratedDocumentStatusPoller,
  GeneratedDocumentSubmitButton,
} from "./GeneratedDocumentAsyncControls";

function operationFor(state: string) {
  if (state === "DRAFT") return "MARK_READY";
  if (state === "READY_FOR_SALES_REVIEW") return "APPROVE";
  if (state === "APPROVED_FOR_DISPATCH") return "DISPATCH";
  return "";
}

export async function GeneratedDocumentsPanel({
  actor,
  mode,
  notice,
}: {
  actor: AuthenticatedSessionUser;
  mode: "documents" | "supplier";
  notice?: string;
}) {
  const workspace = await getGeneratedDocumentWorkspace(actor);
  const locale = actor.preferredLocale ?? "en";
  const copy = generatedDocumentMessages(locale);
  const supplierMode = mode === "supplier";
  const documents = supplierMode
    ? workspace.documents.filter((document) => document.type === "SUPPLIER_PURCHASE_ORDER")
    : workspace.documents;
  const orders = workspace.purchaseOrders;
  const activeJobs = workspace.jobs.some((job) => (
    ["PENDING", "PROCESSING", "RETRY"].includes(job.status)
  ));
  return (
    <section style={{ marginTop: 24 }} aria-labelledby={`generated-documents-${mode}`}>
      <GeneratedDocumentStatusPoller active={activeJobs} label={copy.refreshing} />
      <header className="section-intro">
        <p className="eyebrow">{copy.eyebrow}</p>
        <h2 id={`generated-documents-${mode}`}>{copy.title}</h2>
        <p>{copy.intro}</p>
      </header>
      {notice && copy.notices[notice] ? <p className="form-success" role="status">{copy.notices[notice]}</p> : null}
      {!supplierMode ? <section className="panel" style={{ marginBottom: 17 }}>
        <div className="panel-header"><div><h3>{copy.generated}</h3><p>{copy.history}</p></div></div>
        <div className="data-table-wrap"><table className="data-table">
          <thead><tr><th>{copy.request}</th><th>{copy.type}</th><th>{copy.version}</th><th>{copy.file}</th><th>{copy.status}</th><th>{copy.actions}</th></tr></thead>
          <tbody>{documents.length ? documents.map((document) => <tr key={document.id}>
            <td><strong>{document.requestReference}</strong>{document.supplierName ? <><br /><span className="subtle">{document.supplierName}</span></> : null}</td>
            <td>{document.type.replaceAll("_", " ")}</td>
            <td>{formatGeneratedDocumentNumber(document.version, locale)}<br /><span className="subtle">{formatGeneratedDocumentNumber(document.pageCount, locale)} {copy.pages}</span></td>
            <td><a href={document.downloadUrl}>{copy.download}</a><br /><span className="subtle">{document.checksum.slice(0, 12)}… · {formatGeneratedDocumentNumber(document.fileSize, locale)} {copy.bytes}</span></td>
            <td><StatusBadge>{document.status}</StatusBadge><br /><span className="subtle">{formatGeneratedDocumentDate(document.generatedAt, locale, actor.timezone)}</span></td>
            <td>{document.type !== "SUPPLIER_PURCHASE_ORDER" && document.status === "CURRENT" ? <details><summary>{copy.actions}</summary>
              <form action={regenerateGeneratedDocumentAction} className="stack-form" style={{ marginTop: 12 }}>
                <input type="hidden" name="documentId" value={document.id} />
                <input type="hidden" name="expectedVersion" value={document.version} />
                <input type="hidden" name="commandId" value={randomUUID()} />
                <label>{copy.reason}<textarea name="reason" required minLength={3} maxLength={500} /></label>
                <div className="button-row">
                  <GeneratedDocumentSubmitButton label={copy.regenerate} pendingLabel={copy.pending} name="operation" value="REGENERATE" />
                  <GeneratedDocumentSubmitButton label={copy.correct} pendingLabel={copy.pending} name="operation" value="CORRECT" />
                </div>
              </form>
            </details> : "—"}</td>
          </tr>) : <tr><td colSpan={6}>{copy.noDocuments}</td></tr>}</tbody>
        </table></div>
      </section> : null}

      {!supplierMode ? <section className="panel" style={{ marginBottom: 17 }}>
        <div className="panel-header"><div><h2>{copy.generation}</h2><p>{copy.retry}</p></div></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>{copy.request}</th><th>{copy.type}</th><th>{copy.status}</th><th>{copy.attempts}</th><th>{copy.retry}</th></tr></thead>
          <tbody>{workspace.jobs.length ? workspace.jobs.map((job) => <tr key={job.id}>
            <td>{job.requestReference}{job.supplierName ? <><br /><span className="subtle">{job.supplierName}</span></> : null}<br /><span className="subtle">{copy.reference}: {job.id}</span></td>
            <td>{job.type.replaceAll("_", " ")}</td><td><StatusBadge>{localizedGeneratedDocumentJobStatus(job.status, locale)}</StatusBadge></td>
            <td>{formatGeneratedDocumentNumber(job.attempts, locale)} / {formatGeneratedDocumentNumber(job.maximumAttempts, locale)}</td>
            <td>{job.lastError || formatGeneratedDocumentDate(job.availableAt, locale, actor.timezone)}</td>
          </tr>) : <tr><td colSpan={5}>{copy.noJobs}</td></tr>}</tbody>
        </table></div>
      </section> : null}

      <section className="panel" style={{ marginBottom: 17 }}>
        <div className="panel-header"><div><h2>{copy.purchaseOrders}</h2><p>{copy.history}</p></div></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>{copy.request}</th><th>{copy.supplier}</th><th>{copy.version}</th><th>{copy.status}</th><th>{copy.file}</th><th>{copy.actions}</th></tr></thead>
          <tbody>{orders.length ? orders.map((order) => {
            const primaryOperation = operationFor(order.state);
            const contacts = workspace.supplierContacts.filter((contact) => contact.supplierId === order.supplierId);
            return <tr id={`purchase-order-${order.id}`} key={order.id}>
              <td><strong>{order.requestReference}</strong></td><td>{order.supplierName}</td>
              <td>{formatGeneratedDocumentNumber(order.revision, locale)}</td>
              <td><StatusBadge>{order.state}</StatusBadge>{order.recipientEmail ? <><br /><span className="subtle">{order.recipientEmail}</span></> : null}{order.warnings?.length ? <><br /><span className="subtle">{copy.warnings}: {order.warnings.join(", ")}</span></> : null}</td>
              <td><a href={order.downloadUrl}>{copy.download}</a></td>
              <td>{order.canAcknowledge ? <form action={manageSupplierPurchaseOrderAction}>
                <input type="hidden" name="documentId" value={order.documentId} /><input type="hidden" name="expectedVersion" value={order.version} /><input type="hidden" name="operation" value="ACKNOWLEDGE" /><input type="hidden" name="commandId" value={randomUUID()} /><input type="hidden" name="returnPath" value="/supplier" />
                <GeneratedDocumentSubmitButton className="button button-primary" label={copy.acknowledge} pendingLabel={copy.pending} />
              </form> : order.canDispatch ? <details><summary>{copy.actions}</summary>
                <form action={manageSupplierPurchaseOrderAction} className="stack-form" style={{ marginTop: 12 }}>
                  <input type="hidden" name="documentId" value={order.documentId} /><input type="hidden" name="expectedVersion" value={order.version} /><input type="hidden" name="commandId" value={randomUUID()} /><input type="hidden" name="returnPath" value="/documents" />
                  {primaryOperation === "APPROVE" ? <label>{copy.contacts}<select name="recipientUserId" required defaultValue=""><option value="" disabled>{copy.contacts}</option>{contacts.map((contact) => <option key={contact.userId} value={contact.userId}>{contact.name} · {contact.email}</option>)}</select></label> : null}
                  {!contacts.length && primaryOperation === "APPROVE" ? <p className="form-error" role="alert">{copy.noContact}</p> : null}
                  <label>{copy.reason}<textarea name="reason" maxLength={500} required={["AMEND", "CANCEL"].includes(primaryOperation)} /></label>
                  {primaryOperation ? <GeneratedDocumentSubmitButton className="button button-primary" disabled={primaryOperation === "APPROVE" && !contacts.length} label={primaryOperation === "MARK_READY" ? copy.ready : primaryOperation === "APPROVE" ? copy.approve : copy.dispatch} pendingLabel={copy.pending} name="operation" value={primaryOperation} /> : null}
                  {["DISPATCHED_TO_SUPPLIER", "ACKNOWLEDGED"].includes(order.state) ? <GeneratedDocumentSubmitButton label={copy.resend} pendingLabel={copy.pending} name="operation" value="RESEND" /> : null}
                  {["READY_FOR_SALES_REVIEW", "APPROVED_FOR_DISPATCH", "DISPATCHED_TO_SUPPLIER", "ACKNOWLEDGED"].includes(order.state) ? <GeneratedDocumentSubmitButton label={copy.amend} pendingLabel={copy.pending} name="operation" value="AMEND" /> : null}
                  {!['AMENDED', 'CANCELLED'].includes(order.state) ? <GeneratedDocumentSubmitButton label={copy.cancel} pendingLabel={copy.pending} name="operation" value="CANCEL" /> : null}
                </form>
              </details> : "—"}</td>
            </tr>;
          }) : <tr><td colSpan={6}>{copy.noOrders}</td></tr>}</tbody>
        </table></div>
      </section>

      {!supplierMode && workspace.enqueueFailures.length ? <section className="panel">
        <div className="panel-header"><div><h2>{copy.failure}</h2><p>{copy.retry}</p></div></div>
        <ul>{workspace.enqueueFailures.map((failure) => <li key={failure.id}><strong>{failure.requestReference}</strong>: {failure.errorCode} · {failure.errorSummary}</li>)}</ul>
      </section> : null}
    </section>
  );
}
