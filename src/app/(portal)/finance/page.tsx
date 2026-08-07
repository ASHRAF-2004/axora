import { PageHeader } from "@/components/PageHeader";
import { FinanceManagementForms } from "@/components/FinanceManagementForms";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/domain";
import { loadAuthorizedFinanceRegisters } from "@/lib/finance-isolation";
import { canAccess } from "@/lib/permissions";
import { listSuppliers } from "@/lib/repository";
import { getCustomerMatchWorkspace } from "@/lib/customer-matching";
import { randomUUID } from "node:crypto";
import { evaluateCustomerMatchAction, overrideCustomerMatchAction } from "../operations/actions";
import { operationalMessage, operationalNumber, operationalStatus, type OperationalMessageKey } from "@/lib/operational-i18n";

export default async function FinancePage() {
  const actor = await requirePagePermission("view_invoices");
  const locale = actor.preferredLocale ?? "en";
  const m = (key: OperationalMessageKey, values?: Record<string, string | number>) => operationalMessage(locale, key, values);
  const canManage = canAccess(actor, "manage_finance");
  const canMatch = canAccess(actor, "review_three_way_matches");
  const platformFinance = actor.accountKind === "PLATFORM" && actor.scopeType === "PLATFORM";
  const [finance, suppliers, matching] = await Promise.all([
    loadAuthorizedFinanceRegisters(actor),
    listSuppliers(actor),
    canMatch ? getCustomerMatchWorkspace(actor) : Promise.resolve(null),
  ]);
  const { requests, invoices, payments } = finance;
  const deliveredRequests = requests
    .filter((item) => ["Delivered", "Invoice Issued"].includes(item.status) && item.approvalStatus === "Approved")
    .map((item) => ({
      id: item.id,
      orderCode: item.orderCode,
      companyName: item.companyName,
      status: item.status,
      supplierIds: [...new Set(item.lines.flatMap((line) => line.supplierId ? [line.supplierId] : []))],
    }));
  return <><PageHeader
    eyebrow={m(platformFinance ? "finance.platformEyebrow" : "finance.companyEyebrow")}
    title={m(platformFinance ? "finance.platformTitle" : "finance.companyTitle")}
    description={m(platformFinance ? "finance.platformDescription" : "finance.companyDescription")}
  />
    {canManage ? <FinanceManagementForms
      requests={deliveredRequests}
      suppliers={suppliers.filter((item) => item.status === "Active").map((item) => ({ id: item.id, name: item.name }))}
      invoices={invoices}
      allowSupplierInvoices={platformFinance}
      locale={locale}
    /> : null}
    <section className="panel" style={{ marginTop: canManage ? 17 : 0 }}><div className="panel-header"><div><h2>{m("finance.invoiceRegister")}</h2><p>{m("finance.invoiceCount", { count: operationalNumber(locale, invoices.length) })}</p></div></div><div className="data-table-wrap"><table className="data-table">
      {platformFinance
        ? <><thead><tr><th>{m("finance.invoice")}</th><th>{m("finance.directionRequest")}</th><th>{m("finance.counterparty")}</th><th>{m("finance.dateDue")}</th><th>{m("finance.amount")}</th><th>{m("finance.paid")}</th><th>{m("finance.outstanding")}</th><th>{m("common.status")}</th></tr></thead><tbody>{invoices.map((item) => <tr key={item.id}><td><strong>{item.invoiceNumber}</strong></td><td>{m(item.direction === "CUSTOMER" ? "finance.customer" : "finance.supplier")}<br /><span className="subtle">{item.orderCode}</span></td><td>{item.counterparty}</td><td>{formatDate(item.invoiceDate, locale, actor.timezone)}<br /><span className="subtle">{m("finance.due", { date: formatDate(item.dueDate, locale, actor.timezone) })}</span></td><td>{formatCurrency(item.amount, locale)}</td><td>{formatCurrency(item.paidAmount, locale)}</td><td><strong>{formatCurrency(item.outstandingAmount, locale)}</strong></td><td><StatusBadge>{operationalStatus(locale, item.paymentStatus)}</StatusBadge></td></tr>)}</tbody></>
        : <><thead><tr><th>{m("finance.invoice")}</th><th>{m("finance.request")}</th><th>{m("finance.dateDue")}</th><th>{m("finance.amount")}</th><th>{m("finance.paid")}</th><th>{m("finance.outstanding")}</th><th>{m("common.status")}</th></tr></thead><tbody>{invoices.map((item) => <tr key={item.id}><td><strong>{item.invoiceNumber}</strong></td><td>{item.orderCode}</td><td>{formatDate(item.invoiceDate, locale, actor.timezone)}<br /><span className="subtle">{m("finance.due", { date: formatDate(item.dueDate, locale, actor.timezone) })}</span></td><td>{formatCurrency(item.amount, locale)}</td><td>{formatCurrency(item.paidAmount, locale)}</td><td><strong>{formatCurrency(item.outstandingAmount, locale)}</strong></td><td><StatusBadge>{operationalStatus(locale, item.paymentStatus)}</StatusBadge></td></tr>)}</tbody></>}
    </table></div></section>
    <section className="panel" style={{ marginTop: 17 }}><div className="panel-header"><div><h2>{m("finance.paymentRegister")}</h2><p>{m("finance.paymentIntro")}</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>{m("finance.invoice")}</th><th>{m("finance.date")}</th><th>{m("finance.amount")}</th><th>{m("finance.method")}</th><th>{m("finance.reference")}</th><th>{m("finance.recordedBy")}</th></tr></thead><tbody>{payments.map((item) => <tr key={item.id}><td>{item.invoiceNumber}</td><td>{formatDate(item.paymentDate, locale, actor.timezone)}</td><td><strong>{formatCurrency(item.amount, locale)}</strong></td><td>{item.method}</td><td>{item.reference || "—"}</td><td>{item.recordedByName || "—"}</td></tr>)}</tbody></table></div></section>
    {matching ? <section className="matching-workspace" aria-labelledby="customer-match-title">
      <div className="section-heading"><div><p className="eyebrow">{m("finance.matchEyebrow")}</p><h2 id="customer-match-title">{m("finance.matchTitle")}</h2><p>{m("finance.matchDescription")}</p></div></div>
      <div className="dashboard-grid">
        <article className="panel form-panel"><h3>{m("finance.evaluate")}</h3><form action={evaluateCustomerMatchAction}>
          <input type="hidden" name="idempotencyKey" value={randomUUID()} />
          <div className="form-grid">
            <label className="field-full">{m("finance.approvedLine")}<select name="requestLineId" required defaultValue=""><option value="" disabled>{m("finance.selectLine")}</option>{matching.lines.map((line) => <option value={line.id} key={line.id}>{line.orderCode} · {line.productName} · {operationalNumber(locale, line.quantity)} · {formatCurrency(line.unitPrice, locale)}</option>)}</select></label>
            <label className="field-full">{m("finance.customerInvoice")}<select name="customerInvoiceId" required defaultValue=""><option value="" disabled>{m("finance.selectInvoice")}</option>{matching.invoices.map((invoice) => <option value={invoice.id} key={invoice.id}>{invoice.invoiceNumber} · {formatCurrency(invoice.amount, locale)}</option>)}</select></label>
            <label>{m("finance.invoicedQuantity")}<input name="invoicedQuantity" type="number" min="0" step="0.001" required /></label>
            <label>{m("finance.invoicePrice")}<input name="invoicedUnitPrice" type="number" min="0" step="0.01" required /></label>
          </div><div className="form-actions"><button className="button button-primary" type="submit">{m("finance.runMatch")}</button></div>
        </form></article>
        <article className="panel"><div className="panel-header"><div><h3>{m("finance.meaning")}</h3><p>{m("finance.meaningIntro")}</p></div></div><div className="panel-body"><div className="readiness-list">
          <div className="readiness-item"><strong>{m("finance.matched")}</strong><p>{m("finance.matchedBody")}</p></div>
          <div className="readiness-item"><strong>{m("finance.notReady")}</strong><p>{m("finance.notReadyBody")}</p></div>
          <div className="readiness-item"><strong>{m("finance.exception")}</strong><p>{m("finance.exceptionBody")}</p></div>
        </div></div></article>
      </div>
      <section className="panel" style={{ marginTop: 17 }}><div className="panel-header"><div><h3>{m("finance.matchRegister")}</h3><p>{m("finance.matchCount", { count: operationalNumber(locale, matching.matches.length) })}</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>{m("finance.requestItem")}</th><th>{m("finance.invoice")}</th><th>{m("finance.qty")}</th><th>{m("finance.prices")}</th><th>{m("finance.result")}</th><th>{m("finance.override")}</th></tr></thead><tbody>{matching.matches.map((match) => <tr key={match.id}>
        <td><strong>{match.orderCode}</strong><br /><span className="subtle">{match.productName}</span></td><td>{match.invoiceNumber}</td>
        <td>{operationalNumber(locale, match.orderedQuantity)} / {match.receivedQuantity == null ? m("finance.missing") : operationalNumber(locale, match.receivedQuantity)} / {operationalNumber(locale, match.invoicedQuantity)}</td>
        <td>{formatCurrency(match.orderedUnitPrice, locale)} / {formatCurrency(match.invoicedUnitPrice, locale)}</td>
        <td><StatusBadge>{operationalStatus(locale, match.status)}</StatusBadge><br /><span className="subtle">{match.exceptionCodes.length ? match.exceptionCodes.map((code) => operationalStatus(locale, code)).join(", ") : m("finance.allMatch")}</span></td>
        <td>{["NOT_READY", "EXCEPTION"].includes(match.status) ? <form action={overrideCustomerMatchAction} className="inline-assignment-form"><input type="hidden" name="matchId" value={match.id} /><input name="reason" minLength={3} maxLength={1000} required placeholder={m("finance.overrideReason")} /><button className="button button-secondary" type="submit">{m("finance.overrideButton")}</button></form> : match.overrideReason ?? "—"}</td>
      </tr>)}</tbody></table></div></section>
    </section> : null}
  </>;
}
