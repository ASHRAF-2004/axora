import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { formatDateTime } from "@/lib/domain";
import { listAuditRecords } from "@/lib/operations";
import { operationalMessage, type OperationalMessageKey } from "@/lib/operational-i18n";
import { normalizeAuditRecordFilters } from "@/lib/audit-filters";
import Link from "next/link";

const filterCopy = {
  en: { title: "Filter evidence", intro: "Narrow the tenant-safe audit view without changing its records.", entity: "Entity type", action: "Action", actor: "Actor name", record: "Record ID", from: "From date", to: "To date", apply: "Apply filters", clear: "Clear", result: "{count} matching records" },
  ar: { title: "تصفية الأدلة", intro: "ضيّق عرض التدقيق الآمن للشركة دون تغيير سجلاته.", entity: "نوع الكيان", action: "الإجراء", actor: "اسم المنفذ", record: "معرّف السجل", from: "من تاريخ", to: "إلى تاريخ", apply: "تطبيق المرشحات", clear: "مسح", result: "{count} سجل مطابق" },
  ms: { title: "Tapis bukti", intro: "Kecilkan paparan audit selamat penyewa tanpa mengubah rekodnya.", entity: "Jenis entiti", action: "Tindakan", actor: "Nama pelaku", record: "ID rekod", from: "Tarikh mula", to: "Tarikh akhir", apply: "Guna penapis", clear: "Kosongkan", result: "{count} rekod sepadan" },
} as const;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requirePagePermission("view_audit");
  const locale = actor.preferredLocale ?? "en";
  const m = (key: OperationalMessageKey) => operationalMessage(locale, key);
  const filterMessages = filterCopy[locale];
  const filters = normalizeAuditRecordFilters(await searchParams);
  const records = await listAuditRecords(filters);
  return <><PageHeader eyebrow={m("audit.eyebrow")} title={m("audit.title")} description={m("audit.description")} />
    <section className="panel audit-filter-panel">
      <div className="panel-header"><div><h2>{filterMessages.title}</h2><p>{filterMessages.intro}</p></div></div>
      <form className="audit-filter-form" method="get">
        <label>{filterMessages.entity}<input name="entityType" defaultValue={filters.entityType ?? ""} maxLength={80} placeholder="requests" /></label>
        <label>{filterMessages.action}<input name="action" defaultValue={filters.action ?? ""} maxLength={80} placeholder="UPDATE" /></label>
        <label>{filterMessages.actor}<input name="actor" defaultValue={filters.actor ?? ""} maxLength={100} /></label>
        <label>{filterMessages.record}<input name="recordId" defaultValue={filters.recordId ?? ""} inputMode="text" maxLength={36} /></label>
        <label>{filterMessages.from}<input name="from" type="date" defaultValue={filters.from ?? ""} /></label>
        <label>{filterMessages.to}<input name="to" type="date" defaultValue={filters.to ?? ""} /></label>
        <div className="audit-filter-actions"><button className="button button-primary" type="submit">{filterMessages.apply}</button><Link className="button button-secondary" href="/audit">{filterMessages.clear}</Link></div>
      </form>
    </section>
    <section className="panel"><div className="panel-header"><div><h2>{m("audit.recent")}</h2><p>{filterMessages.result.replace("{count}", new Intl.NumberFormat(locale).format(records.length))} · {m("audit.count")}</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>{m("audit.when")}</th><th>{m("audit.entity")}</th><th>{m("audit.action")}</th><th>{m("audit.record")}</th><th>{m("audit.user")}</th><th>{m("audit.reason")}</th></tr></thead><tbody>{records.length ? records.map((item) => <tr key={item.id}><td>{formatDateTime(item.occurredAt, locale, actor.timezone)}</td><td>{item.entityType}</td><td>{item.action}</td><td><span className="subtle">{item.recordId || "—"}</span></td><td>{item.actorName || m("common.systemMigration")}</td><td>{item.reason || "—"}</td></tr>) : <tr><td colSpan={6}>{m("audit.empty")}</td></tr>}</tbody></table></div></section>
  </>;
}
