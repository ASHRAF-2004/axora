import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { getSupplierWorkspace } from "@/lib/role-portals-repository";
import {
  formatRolePortalDate,
  formatRolePortalDateTime,
  formatRolePortalMoney,
  formatRolePortalNumber,
  formatRolePortalStatus,
  rolePortalMessages,
} from "@/lib/role-portals-i18n";
import styles from "@/components/role-portals/RolePortals.module.css";
import {
  acknowledgeSupplierRfqAction,
  submitSupplierQuotationAction,
  uploadSupplierDocumentAction,
} from "./actions";
import { randomUUID } from "node:crypto";

export default async function SupplierPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const actor = await requirePagePermission("view_supplier_portal");
  const [{ supplierName, profile, rfqs, invoices = [] }, params] = await Promise.all([
    getSupplierWorkspace(actor),
    searchParams,
  ]);
  const locale = actor.preferredLocale ?? "en";
  const copy = rolePortalMessages(locale);
  const supplier = copy.supplier;
  const actionable = rfqs.filter((rfq) => rfq.selected || !["WITHDRAWN", "EXPIRED", "CLOSED", "DECLINED"].includes(rfq.status)).length;
  return (
    <>
      <PageHeader
        eyebrow={supplier.eyebrow}
        title={supplierName}
        description={supplier.description}
      />
      {params.notice && supplier.notices[params.notice] ? <p className="form-success" role="status">{supplier.notices[params.notice]}</p> : null}
      {profile ? <section className="panel" style={{ marginBottom: 17 }}>
        <div className="panel-header"><div><h2>{supplier.profileTitle}</h2><p>{supplier.profileIntro}</p></div></div>
        <dl className={styles.factGrid}>
          <div><dt>{supplier.contact}</dt><dd>{profile.contactName || "—"}<br />{profile.email || "—"}<br />{profile.phone || "—"}</dd></div>
          <div><dt>{supplier.category}</dt><dd>{profile.category || "—"}</dd></div>
          <div><dt>{supplier.coverage}</dt><dd>{profile.coverageArea || "—"}</dd></div>
          <div><dt>{supplier.address}</dt><dd>{profile.address || "—"}</dd></div>
          <div><dt>{supplier.paymentTerms}</dt><dd>{profile.paymentTerms || "—"}</dd></div>
          <div><dt>{supplier.standardLeadTime}</dt><dd>{formatRolePortalNumber(profile.leadTimeDays, locale)}</dd></div>
          <div><dt>{supplier.mainProducts}</dt><dd>{profile.mainProducts || "—"}</dd></div>
        </dl>
      </section> : null}
      <section className={styles.metrics} aria-label={supplier.summaryLabel}>
        <div><span>{supplier.assignedRfqs}</span><strong>{formatRolePortalNumber(rfqs.length, locale)}</strong></div>
        <div><span>{supplier.actionable}</span><strong>{formatRolePortalNumber(actionable, locale)}</strong></div>
        <div><span>{supplier.submittedQuotations}</span><strong>{formatRolePortalNumber(rfqs.filter((rfq) => rfq.responseVersion).length, locale)}</strong></div>
      </section>
      {rfqs.length === 0 ? (
        <section className={`${styles.empty} panel`}><h2>{supplier.emptyTitle}</h2><p>{supplier.emptyBody}</p></section>
      ) : (
        <div className={styles.cardList}>
          {rfqs.map((rfq) => {
            const closed = ["WITHDRAWN", "EXPIRED", "CLOSED", "DECLINED"].includes(rfq.status) && !rfq.selected;
            return (
              <article className={styles.workCard} id={`rfq-${rfq.id}`} key={rfq.id}>
                <header className={styles.cardHeader}>
                  <div><span className={styles.reference}>{rfq.reference}</span><h2>{rfq.productName}</h2></div>
                  <StatusBadge>{formatRolePortalStatus(rfq.status, locale)}</StatusBadge>
                </header>
                {rfq.selected ? <div className="callout" style={{ margin: 18 }}><strong>{supplier.selectedOrder}</strong><p>{supplier.selectedOrderHelp}</p></div> : null}
                <dl className={styles.factGrid}>
                  <div><dt>{supplier.order}</dt><dd>{rfq.orderCode} · {formatRolePortalStatus(rfq.requestStatus, locale)}</dd></div>
                  <div><dt>{supplier.quantity}</dt><dd>{formatRolePortalNumber(rfq.quantity, locale)} {rfq.unit}</dd></div>
                  <div><dt>{supplier.respondBy}</dt><dd>{formatRolePortalDate(rfq.respondBy, locale, supplier.noDeadline)}</dd></div>
                  <div><dt>{supplier.latestResponse}</dt><dd>{rfq.responseVersion ? supplier.quotationVersion(rfq.responseVersion, formatRolePortalStatus(rfq.responseStatus, locale)) : supplier.notSubmitted}</dd></div>
                  <div><dt>{supplier.quotedUnitPrice}</dt><dd>{formatRolePortalMoney(rfq.unitPrice, locale)}</dd></div>
                  <div><dt>{supplier.availability}</dt><dd>{rfq.availability ? supplier.availabilityLabels[rfq.availability] : "—"}</dd></div>
                </dl>
                {rfq.specification ? <div className={styles.specification}><strong>{supplier.specification}</strong><p>{rfq.specification}</p></div> : null}
                {rfq.documents.length ? (
                  <div className={styles.documents}>
                    <strong>{supplier.documents}</strong>
                    <ul>{rfq.documents.map((document) => (
                      <li key={document.id}>
                        <a href={`/api/supplier/documents/${document.id}`}>{document.fileName}</a>
                        <span>{supplier.documentVersion(formatRolePortalStatus(document.documentKind, locale), document.documentVersion)}</span>
                      </li>
                    ))}</ul>
                  </div>
                ) : null}
                {rfq.acknowledgements?.length ? <div className={styles.documents}>
                  <strong>{supplier.responseHistory}</strong>
                  <ul>{rfq.acknowledgements.map((entry) => <li key={entry.id}><span><strong>{formatRolePortalStatus(entry.acknowledgement, locale)}</strong><br />{entry.note || supplier.noResponseNote}</span><span>{formatRolePortalDateTime(entry.acknowledgedAt, locale)}</span></li>)}</ul>
                </div> : null}
                {!closed ? (
                  <div className={styles.actionPanels}>
                    <details>
                      <summary>{rfq.selected ? supplier.selectedOrderResponse : supplier.acknowledgeSummary}</summary>
                      <form action={acknowledgeSupplierRfqAction} className={styles.compactForm}>
                        <input type="hidden" name="rfqId" value={rfq.id} />
                        <input type="hidden" name="clientEventId" value={randomUUID()} />
                        <label>{supplier.response}<select name="acknowledgement" defaultValue="ACKNOWLEDGED" required><option value="ACKNOWLEDGED">{supplier.acknowledge}</option>{!rfq.selected ? <><option value="CLARIFICATION_REQUESTED">{supplier.requestClarification}</option><option value="DECLINED">{supplier.decline}</option></> : null}</select></label>
                        <label>{supplier.note}<textarea name="note" maxLength={2000} placeholder={supplier.buyerContextPlaceholder} /></label>
                        <button className="button button-secondary" type="submit">{supplier.recordResponse}</button>
                      </form>
                    </details>
                    {!rfq.selected ? <details>
                      <summary>{rfq.responseVersion ? supplier.submitRevised : supplier.submitQuotation}</summary>
                      <form action={submitSupplierQuotationAction} className={styles.compactForm}>
                        <input type="hidden" name="rfqId" value={rfq.id} />
                        <input type="hidden" name="clientEventId" value={randomUUID()} />
                        <div className={styles.formColumns}>
                          <label>{supplier.quotationReference}<input name="quotationReference" required maxLength={120} defaultValue={rfq.quotationReference} /></label>
                          <label>{supplier.unitPrice}<input name="unitPrice" type="number" min="0" step="0.01" required defaultValue={rfq.unitPrice} /></label>
                          <label>{supplier.deliveryCharge}<input name="deliveryCharge" type="number" min="0" step="0.01" required defaultValue={rfq.deliveryCharge ?? 0} /></label>
                          <label>{supplier.minimumOrderQuantity}<input name="minimumOrderQuantity" type="number" min="0" step="0.001" /></label>
                          <label>{supplier.leadTimeDays}<input name="leadTimeDays" type="number" min="0" step="1" defaultValue={rfq.leadTimeDays} /></label>
                          <label>{supplier.validUntil}<input name="validUntil" type="date" defaultValue={rfq.validUntil?.slice(0, 10)} /></label>
                          <label>{supplier.availability}<select name="availability" required defaultValue={rfq.availability ?? "AVAILABLE"}>{Object.entries(supplier.availabilityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                        </div>
                        <label>{supplier.commercialNote}<textarea name="note" maxLength={2000} /></label>
                        <button className="button button-primary" type="submit">{supplier.submitVersioned}</button>
                      </form>
                    </details> : null}
                    {!rfq.selected ? <details>
                      <summary>{supplier.uploadSummary}</summary>
                      <form action={uploadSupplierDocumentAction} className={styles.compactForm}>
                        <input type="hidden" name="rfqId" value={rfq.id} />
                        <input type="hidden" name="documentKind" value="QUOTATION" />
                        <label>{supplier.pdfOrImage}<input name="document" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" /></label>
                        <p className={styles.hint}>{supplier.uploadHint}</p>
                        <button className="button button-secondary" type="submit">{supplier.uploadDocument}</button>
                      </form>
                    </details> : null}
                    {rfq.selected ? <details>
                      <summary>{supplier.uploadInvoiceSummary}</summary>
                      <form action={uploadSupplierDocumentAction} className={styles.compactForm}>
                        <input type="hidden" name="rfqId" value={rfq.id} />
                        <input type="hidden" name="documentKind" value="SUPPORTING" />
                        <label>{supplier.pdfOrImage}<input name="document" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" /></label>
                        <p className={styles.hint}>{supplier.uploadInvoiceHint}</p>
                        <button className="button button-secondary" type="submit">{supplier.uploadDocument}</button>
                      </form>
                    </details> : null}
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
      <section className="panel" style={{ marginTop: 17 }}>
        <div className="panel-header"><div><h2>{supplier.invoiceTitle}</h2><p>{supplier.invoiceIntro}</p></div></div>
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>{supplier.invoiceNumber}</th><th>{supplier.order}</th><th>{supplier.amount}</th><th>{supplier.paymentStatus}</th></tr></thead><tbody>
          {invoices.length ? invoices.map((invoice) => <tr key={invoice.id}><td><strong>{invoice.invoiceNumber}</strong><br /><span className="subtle">{formatRolePortalDate(invoice.invoiceDate, locale)}</span></td><td>{invoice.orderCode}</td><td>{formatRolePortalMoney(invoice.amount, locale)}</td><td><StatusBadge>{formatRolePortalStatus(invoice.paymentStatus, locale)}</StatusBadge><br /><span className="subtle">{formatRolePortalMoney(invoice.outstandingAmount, locale)}</span></td></tr>) : <tr><td colSpan={4}>{supplier.noInvoices}</td></tr>}
        </tbody></table></div>
      </section>
    </>
  );
}
