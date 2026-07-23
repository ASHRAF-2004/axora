import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { formatCurrency, formatDate } from "@/lib/domain";
import { listQuotations } from "@/lib/operations";
import { listRequests, listSuppliers } from "@/lib/repository";
import { CheckCircle2, Scale } from "lucide-react";
import { createQuotationAction, selectQuotationAction } from "../operations/actions";

export default async function SourcingPage() {
  const [requests, suppliers, quotations] = await Promise.all([listRequests(), listSuppliers(), listQuotations()]);
  const lines = requests.flatMap((request) => request.lines.map((line) => ({ ...line, orderCode: request.orderCode })));
  return <><PageHeader eyebrow="Supplier control" title="Sourcing and quotations" description="Capture comparable supplier offers, then select one with a written reason. The selected price becomes the request line buying price." />
    <section className="detail-grid"><article className="panel form-panel"><h2>Add a quotation</h2><p>Use the supplier&apos;s real written quotation. Do not guess a reference or price.</p>
      <form action={createQuotationAction}><div className="form-grid">
        <label className="field-full">Request line<select name="requestLineId" required defaultValue=""><option value="" disabled>Select line</option>{lines.map((line) => <option key={line.id} value={line.id}>{line.orderCode} · {line.code} · {line.productName}</option>)}</select></label>
        <label>Supplier<select name="supplierId" required defaultValue=""><option value="" disabled>Select supplier</option>{suppliers.filter((item) => item.status === "Active").map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
        <label>Quotation reference<input name="quotationReference" required placeholder="QT-2026-001" /></label>
        <label>Quotation date<input name="quotationDate" type="date" required /></label><label>Valid until<input name="validUntil" type="date" /></label>
        <label>Unit buying price (RM)<input name="unitPrice" type="number" min="0" step="0.01" required /></label><label>Delivery fee (RM)<input name="deliveryCharge" type="number" min="0" step="0.01" defaultValue="0" required /></label>
        <label>Supplier MOQ<input name="minimumOrderQuantity" type="number" min="0.01" step="0.01" /></label><label>Lead time (days)<input name="leadTimeDays" type="number" min="0" step="1" /></label>
      </div><div className="form-actions"><button className="button button-primary" type="submit">Save quotation</button></div></form>
    </article><aside className="panel"><div className="panel-header"><div><h2>Selection rule</h2><p>Price is only one part of the decision</p></div><Scale /></div><div className="panel-body readiness-list">
      <div className="readiness-item"><CheckCircle2 /><div><strong>Compare like with like</strong><p>Check unit, MOQ, delivery fee, validity, and lead time.</p></div></div>
      <div className="readiness-item"><CheckCircle2 /><div><strong>Write the reason</strong><p>The audit trail must explain why an offer was chosen.</p></div></div>
    </div></aside></section>
    <section className="panel" style={{ marginTop: 17 }}><div className="panel-header"><div><h2>Quotation register</h2><p>{quotations.length} recorded offer{quotations.length === 1 ? "" : "s"}</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Request / product</th><th>Supplier</th><th>Reference</th><th>Unit price</th><th>Fee / lead</th><th>Status</th><th>Decision</th></tr></thead><tbody>
      {quotations.map((item) => <tr key={item.id}><td><strong>{item.orderCode}</strong><br /><span className="subtle">{item.requestLineCode} · {item.productName}</span></td><td>{item.supplierName}</td><td>{item.quotationReference}<br /><span className="subtle">{formatDate(item.quotationDate)}</span></td><td><strong>{formatCurrency(item.unitPrice)}</strong></td><td>{formatCurrency(item.deliveryCharge)}<br /><span className="subtle">{item.leadTimeDays ?? "—"} days</span></td><td><StatusBadge>{item.selected ? "Selected" : item.status}</StatusBadge></td><td>{item.selected ? <span className="subtle">{item.selectionReason || "Chosen offer"}</span> : <form action={selectQuotationAction.bind(null, item.id)}><input name="reason" required placeholder="Why this offer?" aria-label={`Selection reason for ${item.quotationReference}`} /><button className="button button-secondary" type="submit">Select</button></form>}</td></tr>)}
    </tbody></table></div></section>
  </>;
}
