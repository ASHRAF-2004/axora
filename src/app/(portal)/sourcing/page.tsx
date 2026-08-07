import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/domain";
import { listSuppliers } from "@/lib/repository";
import { loadAuthorizedSourcingRegisters } from "@/lib/sourcing-isolation";
import { CheckCircle2, Scale } from "lucide-react";
import { operationalMessage, operationalNumber, operationalStatus, type OperationalMessageKey } from "@/lib/operational-i18n";
import { createQuotationAction, issueSupplierRfqAction, selectQuotationAction } from "../operations/actions";
import { supplierSourcingMessages } from "@/lib/supplier-sourcing-i18n";
import { randomUUID } from "node:crypto";

export default async function SourcingPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const actor = await requirePagePermission("manage_sourcing");
  const locale = actor.preferredLocale ?? "en";
  const m = (key: OperationalMessageKey, values?: Record<string, string | number>) => operationalMessage(locale, key, values);
  const supplierCopy = supplierSourcingMessages(locale);
  const platformView = actor.isOwner || actor.accountKind === "PLATFORM";
  const canManage = true;
  const [sourcing, suppliers, params] = await Promise.all([
    loadAuthorizedSourcingRegisters(actor),
    listSuppliers(actor),
    searchParams,
  ]);
  const { requests, quotations, supplierRfqs } = sourcing;
  const lines = requests.filter((request) =>
    request.status === "Waiting for Quotation" && request.approvalStatus === "Approved")
    .flatMap((request) => request.lines.map((line) => ({ ...line, orderCode: request.orderCode, companyName: request.companyName })));
  const sourceableLineIds = new Set(lines.map((line) => line.id));
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kuala_Lumpur" });
  const unavailableReason = (quotation: (typeof quotations)[number]) => {
    if (quotation.supplierActive === false) return m("sourcing.inactive");
    if (quotation.minimumOrderQuantity && quotation.requestLineQuantity && quotation.minimumOrderQuantity > quotation.requestLineQuantity) {
      return m("sourcing.moqExceeds", { count: operationalNumber(locale, quotation.minimumOrderQuantity) });
    }
    if (quotation.validUntil && quotation.validUntil < today) return m("sourcing.expired");
    return "";
  };
  return <><PageHeader eyebrow={m("sourcing.eyebrow")} title={m("sourcing.title")} description={m("sourcing.description")} />
    {params.notice === "rfq-issued" ? <p className="form-success" role="status">{supplierCopy.issuedNotice}</p> : null}
    {canManage ? <section className="panel form-panel" style={{ marginBottom: 17 }}>
      <div className="panel-header"><div><h2>{supplierCopy.issueTitle}</h2><p>{supplierCopy.issueIntro}</p></div></div>
      <form action={issueSupplierRfqAction} className="panel-body">
        <input type="hidden" name="idempotencyKey" value={randomUUID()} />
        <div className="form-grid">
          <label className="field-full">{supplierCopy.line}<select name="requestLineId" required defaultValue=""><option value="" disabled>{supplierCopy.selectLine}</option>{lines.map((line) => <option key={line.id} value={line.id}>{line.companyName} · {line.orderCode} · {line.code} · {line.productName}</option>)}</select></label>
          <label>{supplierCopy.supplier}<select name="supplierId" required defaultValue=""><option value="" disabled>{supplierCopy.selectSupplier}</option>{suppliers.filter((item) => item.status === "Active" && !item.companyName).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
          <label>{supplierCopy.reference}<input name="reference" required minLength={3} maxLength={80} placeholder="RFQ-2026-001" /></label>
          <label>{supplierCopy.deadline}<input name="respondBy" type="datetime-local" required /></label>
          <label className="field-full">{supplierCopy.specification}<textarea name="specification" maxLength={2000} placeholder={supplierCopy.specificationPlaceholder} /></label>
        </div>
        <div className="form-actions"><button className="button button-primary" type="submit">{supplierCopy.issue}</button></div>
      </form>
    </section> : null}
    {canManage ? <section className="detail-grid"><article className="panel form-panel"><h2>{m("sourcing.add")}</h2><p>{m("sourcing.intro")}</p>
      <form action={createQuotationAction}><div className="form-grid">
        <label className="field-full">{m("sourcing.line")}<select name="requestLineId" required defaultValue=""><option value="" disabled>{m("sourcing.selectLine")}</option>{lines.map((line) => <option key={line.id} value={line.id}>{line.companyName} · {line.orderCode} · {line.code} · {line.productName}</option>)}</select></label>
        <label>{m("sourcing.supplier")}<select name="supplierId" required defaultValue=""><option value="" disabled>{m("sourcing.selectSupplier")}</option>{suppliers.filter((item) => item.status === "Active").map((item) => <option key={item.id} value={item.id}>{platformView && item.companyName ? `${item.companyName} · ` : ""}{item.code} · {item.name}</option>)}</select></label>
        <label>{m("sourcing.reference")}<input name="quotationReference" required placeholder="QT-2026-001" /></label>
        <label>{m("sourcing.date")}<input name="quotationDate" type="date" required /></label><label>{m("sourcing.valid")}<input name="validUntil" type="date" /></label>
        <label>{m("sourcing.price")}<input name="unitPrice" type="number" min="0" step="0.01" required /></label><label>{m("sourcing.fee")}<input name="deliveryCharge" type="number" min="0" step="0.01" defaultValue="0" required /></label>
        <label>{m("sourcing.moq")}<input name="minimumOrderQuantity" type="number" min="0.01" step="0.01" /></label><label>{m("sourcing.lead")}<input name="leadTimeDays" type="number" min="0" step="1" /></label>
      </div><div className="form-actions"><button className="button button-primary" type="submit">{m("sourcing.save")}</button></div></form>
    </article><aside className="panel"><div className="panel-header"><div><h2>{m("sourcing.rule")}</h2><p>{m("sourcing.ruleIntro")}</p></div><Scale /></div><div className="panel-body readiness-list">
      <div className="readiness-item"><CheckCircle2 /><div><strong>{m("sourcing.compare")}</strong><p>{m("sourcing.compareBody")}</p></div></div>
      <div className="readiness-item"><CheckCircle2 /><div><strong>{m("sourcing.reason")}</strong><p>{m("sourcing.reasonBody")}</p></div></div>
    </div></aside></section> : null}
    <section className="panel" style={{ marginTop: 17 }}><div className="panel-header"><div><h2>{supplierCopy.activityTitle}</h2><p>{supplierCopy.activityIntro}</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>{supplierCopy.request}</th><th>{supplierCopy.supplier}</th><th>{supplierCopy.reference}</th><th>{m("common.status")}</th><th>{supplierCopy.responses}</th><th>{supplierCopy.issued}</th></tr></thead><tbody>
      {supplierRfqs.length ? supplierRfqs.map((rfq) => <tr key={rfq.id}><td><strong>{rfq.orderCode}</strong><br /><span className="subtle">{rfq.requestLineCode} · {rfq.productName}</span></td><td>{rfq.supplierName}</td><td>{rfq.reference}<br /><span className="subtle">{formatRolePortalDeadline(rfq.respondBy, locale, actor.timezone)}</span></td><td><StatusBadge>{operationalStatus(locale, rfq.status)}</StatusBadge></td><td>{operationalNumber(locale, rfq.responseCount)}</td><td>{formatDateTime(rfq.issuedAt, locale, actor.timezone)}</td></tr>) : <tr><td colSpan={6}>{supplierCopy.noRfqs}</td></tr>}
    </tbody></table></div></section>
    <section className="panel" style={{ marginTop: 17 }}><div className="panel-header"><div><h2>{m("sourcing.register")}</h2><p>{m("sourcing.count", { count: operationalNumber(locale, quotations.length) })}</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>{m("sourcing.requestProduct")}</th><th>{m("sourcing.supplier")}</th><th>{m("sourcing.referenceColumn")}</th><th>{m("sourcing.unitPrice")}</th><th>{m("sourcing.feeLead")}</th><th>{m("common.status")}</th><th>{m("sourcing.decision")}</th></tr></thead><tbody>
      {quotations.map((item) => {
        const unavailable = unavailableReason(item);
        return <tr key={item.id}><td><strong>{item.orderCode}</strong><br /><span className="subtle">{item.requestLineCode} · {item.productName}</span></td><td>{item.supplierName}</td><td>{item.quotationReference}<br /><span className="subtle">{formatDate(item.quotationDate, locale, actor.timezone)}{item.validUntil ? ` · ${m("sourcing.validTo", { date: formatDate(item.validUntil, locale, actor.timezone) })}` : ""}</span></td><td><strong>{formatCurrency(item.unitPrice, locale)}</strong><br /><span className="subtle">MOQ {item.minimumOrderQuantity == null ? "—" : operationalNumber(locale, item.minimumOrderQuantity)}</span></td><td>{formatCurrency(item.deliveryCharge, locale)}<br /><span className="subtle">{item.leadTimeDays == null ? "—" : m(item.leadTimeDays === 1 ? "common.day" : "common.days", { count: operationalNumber(locale, item.leadTimeDays) })}</span></td><td><StatusBadge>{item.selected ? operationalStatus(locale, "Selected") : unavailable || operationalStatus(locale, item.status)}</StatusBadge></td><td>{item.selected || unavailable || !canManage || !sourceableLineIds.has(item.requestLineId) ? <span className="subtle">{item.selectionReason || unavailable || (item.selected ? m("sourcing.chosen") : m("common.readOnly"))}</span> : <form action={selectQuotationAction.bind(null, item.id)}><input name="reason" required placeholder={m("sourcing.reasonPlaceholder")} aria-label={m("sourcing.reasonLabel", { reference: item.quotationReference })} /><button className="button button-secondary" type="submit">{m("common.select")}</button></form>}</td></tr>;
      })}
    </tbody></table></div></section>
  </>;
}

function formatRolePortalDeadline(value: string | undefined, locale: "en" | "ar" | "ms", timezone?: string) {
  return value ? formatDateTime(value, locale, timezone) : "—";
}
