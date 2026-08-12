import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { requirePagePermission } from "@/lib/auth";
import { listSuppliers } from "@/lib/repository";
import { STANDARD_BILLING_TERMS } from "@/lib/types";
import { operationalMessage, operationalNumber, operationalStatus, type OperationalMessageKey } from "@/lib/operational-i18n";
import { createSupplierAction, setMasterActiveAction } from "../masters/actions";

export default async function SuppliersPage() {
  const actor = await requirePagePermission("manage_suppliers");
  const locale = actor.preferredLocale ?? "en";
  const m = (key: OperationalMessageKey, values?: Record<string, string | number>) => operationalMessage(locale, key, values);
  const suppliers = await listSuppliers(actor);
  return <><PageHeader eyebrow={m("suppliers.eyebrow")} title={m("suppliers.title")} description={m("suppliers.description")} />
    <section className="split-layout"><article className="panel"><div className="panel-header"><div><h2>{m("suppliers.register")}</h2><p>{m("suppliers.count", { count: operationalNumber(locale, suppliers.length) })}</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>{m("suppliers.code")}</th><th>{m("suppliers.supplier")}</th><th>{m("suppliers.category")}</th><th>{m("suppliers.coverage")}</th><th>{m("suppliers.lead")}</th><th>{m("common.status")}</th><th>{m("common.action")}</th></tr></thead><tbody>{suppliers.map((supplier) => <tr key={supplier.id}><td><strong>{supplier.code}</strong></td><td><strong>{supplier.name}</strong><br /><span className="subtle">{supplier.contactName} · {supplier.email}</span></td><td>{supplier.category}</td><td>{supplier.coverageArea}</td><td>{m(supplier.leadTimeDays === 1 ? "common.day" : "common.days", { count: operationalNumber(locale, supplier.leadTimeDays) })}<br /><span className="subtle">{supplier.paymentTerms}</span></td><td><StatusBadge>{operationalStatus(locale, supplier.status)}</StatusBadge></td><td><form action={setMasterActiveAction.bind(null, "suppliers", supplier.id, supplier.status !== "Active")}><button className="button button-secondary" type="submit">{m(supplier.status === "Active" ? "common.deactivate" : "common.activate")}</button></form></td></tr>)}</tbody></table></div></article>
    <form action={createSupplierAction} className="panel form-panel"><h2>{m("suppliers.createTitle")}</h2><p>{m("suppliers.createIntro")}</p><div className="form-grid">
      <label className="field-full">{m("suppliers.name")}<input name="name" required /></label><label>{m("suppliers.category")}<input name="category" required /></label><label>{m("suppliers.area")}<input name="coverageArea" required /></label><label>{m("suppliers.contact")}<input name="contactName" required /></label><label>{m("suppliers.phone")}<input name="phone" required /></label><label className="field-full">{m("suppliers.email")}<input name="email" type="email" /></label><label className="field-full">{m("suppliers.address")}<textarea name="address" required /></label>
      <input type="hidden" name="paymentTerms" value={STANDARD_BILLING_TERMS} /><label>{m("suppliers.leadDays")}<input name="leadTimeDays" type="number" min="0" defaultValue="1" /></label><label>{m("suppliers.minimum")}<input name="minimumOrderQuantity" type="number" min="0.01" step="0.01" defaultValue="1" /></label><label>{m("suppliers.products")}<input name="mainProducts" required /></label><label className="field-full">{m("suppliers.notes")}<textarea name="notes" /></label>
    </div><div className="form-actions"><button className="button button-primary" type="submit">{m("suppliers.submit")}</button></div></form></section></>;
}
