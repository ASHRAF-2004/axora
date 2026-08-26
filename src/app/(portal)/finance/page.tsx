import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { formatCurrency, formatDate } from "@/lib/domain";
import { loadAuthorizedFinanceRegisters } from "@/lib/finance-isolation";
import { canViewInternalFinance } from "@/lib/operational-isolation";
import {
  operationalMessage,
  operationalNumber,
  operationalStatus,
  type OperationalMessageKey,
} from "@/lib/operational-i18n";

export default async function FinancePage() {
  const actor = await requirePagePermission("view_invoices");
  const locale = actor.preferredLocale ?? "en";
  const m = (key: OperationalMessageKey, values?: Record<string, string | number>) =>
    operationalMessage(locale, key, values);
  const platformFinance = canViewInternalFinance(actor);
  const { invoices, payments } = await loadAuthorizedFinanceRegisters(actor);

  return <>
    <PageHeader
      eyebrow={m(platformFinance ? "finance.platformEyebrow" : "finance.companyEyebrow")}
      title={m(platformFinance ? "finance.platformTitle" : "finance.companyTitle")}
      description={m(platformFinance ? "finance.platformDescription" : "finance.companyDescription")}
    />
    <section className="panel">
      <div className="panel-header"><div>
        <h2>{m("finance.invoiceRegister")}</h2>
        <p>{m("finance.invoiceCount", { count: operationalNumber(locale, invoices.length) })}</p>
      </div></div>
      <div className="data-table-wrap"><table className="data-table">
        {platformFinance ? <>
          <thead><tr>
            <th>{m("finance.invoice")}</th><th>{m("finance.directionRequest")}</th>
            <th>{m("finance.counterparty")}</th><th>{m("finance.dateDue")}</th>
            <th>{m("finance.amount")}</th><th>{m("finance.paid")}</th>
            <th>{m("finance.outstanding")}</th><th>{m("common.status")}</th>
          </tr></thead>
          <tbody>{invoices.map((item) => <tr key={item.id}>
            <td><strong>{item.invoiceNumber}</strong></td>
            <td>{m(item.direction === "CUSTOMER" ? "finance.customer" : "finance.supplier")}<br /><span className="subtle">{item.orderCode}</span></td>
            <td>{item.counterparty}</td>
            <td>{formatDate(item.invoiceDate, locale, actor.timezone)}<br /><span className="subtle">{m("finance.due", { date: formatDate(item.dueDate, locale, actor.timezone) })}</span></td>
            <td>{formatCurrency(item.amount, locale)}</td>
            <td>{formatCurrency(item.paidAmount, locale)}</td>
            <td><strong>{formatCurrency(item.outstandingAmount, locale)}</strong></td>
            <td><StatusBadge>{operationalStatus(locale, item.paymentStatus)}</StatusBadge></td>
          </tr>)}</tbody>
        </> : <>
          <thead><tr>
            <th>{m("finance.invoice")}</th><th>{m("finance.request")}</th>
            <th>{m("finance.dateDue")}</th><th>{m("finance.amount")}</th>
            <th>{m("finance.paid")}</th><th>{m("finance.outstanding")}</th>
            <th>{m("common.status")}</th>
          </tr></thead>
          <tbody>{invoices.map((item) => <tr key={item.id}>
            <td><strong>{item.invoiceNumber}</strong></td><td>{item.orderCode}</td>
            <td>{formatDate(item.invoiceDate, locale, actor.timezone)}<br /><span className="subtle">{m("finance.due", { date: formatDate(item.dueDate, locale, actor.timezone) })}</span></td>
            <td>{formatCurrency(item.amount, locale)}</td><td>{formatCurrency(item.paidAmount, locale)}</td>
            <td><strong>{formatCurrency(item.outstandingAmount, locale)}</strong></td>
            <td><StatusBadge>{operationalStatus(locale, item.paymentStatus)}</StatusBadge></td>
          </tr>)}</tbody>
        </>}
      </table></div>
    </section>
    <section className="panel" style={{ marginTop: 17 }}>
      <div className="panel-header"><div>
        <h2>{m("finance.paymentRegister")}</h2><p>{m("finance.paymentIntro")}</p>
      </div></div>
      <div className="data-table-wrap"><table className="data-table">
        <thead><tr>
          <th>{m("finance.invoice")}</th><th>{m("finance.date")}</th>
          <th>{m("finance.amount")}</th><th>{m("finance.reference")}</th>
          <th>{m("finance.recordedBy")}</th>
        </tr></thead>
        <tbody>{payments.map((item) => <tr key={item.id}>
          <td>{item.invoiceNumber}</td><td>{formatDate(item.paymentDate, locale, actor.timezone)}</td>
          <td><strong>{formatCurrency(item.amount, locale)}</strong></td>
          <td>{item.reference || "—"}</td><td>{item.recordedByName || "—"}</td>
        </tr>)}</tbody>
      </table></div>
    </section>
  </>;
}
