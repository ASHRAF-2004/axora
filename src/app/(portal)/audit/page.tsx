import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { listScopedAuditRecords as listAuthorizedAuditRecords } from "@/lib/accountability-reader";
import { formatDateTime } from "@/lib/domain";
import { operationalMessage, type OperationalMessageKey } from "@/lib/operational-i18n";
import { normalizeAuditRecordFilters } from "@/lib/audit-filters";
import Link from "next/link";

const filterCopy = {
  en: { title: "Filter evidence", intro: "Narrow the tenant-safe audit view without changing its records.", entity: "Entity type", action: "Action", actor: "Actor name", record: "Record ID", company: "Company ID", branch: "Branch ID", department: "Department ID", request: "Request ID", delivery: "Delivery ID", outcome: "Outcome", from: "From date", to: "To date", apply: "Apply filters", clear: "Clear", export: "Export scoped evidence", result: "{count} matching records", role: "Role", scope: "Scope", integrity: "Integrity" },
  ar: { title: "تصفية الأدلة", intro: "ضيّق عرض التدقيق الآمن للشركة دون تغيير سجلاته.", entity: "نوع الحدث أو الكيان", action: "الإجراء", actor: "اسم المنفذ", record: "معرّف السجل", company: "معرّف الشركة", branch: "معرّف الفرع", department: "معرّف القسم", request: "معرّف الطلب", delivery: "معرّف التسليم", outcome: "النتيجة", from: "من تاريخ", to: "إلى تاريخ", apply: "تطبيق المرشحات", clear: "مسح", export: "تصدير الأدلة المصرح بها", result: "{count} سجل مطابق", role: "الدور", scope: "النطاق", integrity: "السلامة" },
  ms: { title: "Tapis bukti", intro: "Kecilkan paparan audit selamat penyewa tanpa mengubah rekodnya.", entity: "Jenis peristiwa atau entiti", action: "Tindakan", actor: "Nama pelaku", record: "ID rekod", company: "ID syarikat", branch: "ID cawangan", department: "ID jabatan", request: "ID permintaan", delivery: "ID penghantaran", outcome: "Hasil", from: "Tarikh mula", to: "Tarikh akhir", apply: "Guna penapis", clear: "Kosongkan", export: "Eksport bukti berskop", result: "{count} rekod sepadan", role: "Peranan", scope: "Skop", integrity: "Integriti" },
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
  const records = await listAuthorizedAuditRecords(actor, filters);
  const exportSearch = new URLSearchParams(Object.entries(filters).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  return <><PageHeader eyebrow={m("audit.eyebrow")} title={m("audit.title")} description={m("audit.description")} />
    <section className="panel audit-filter-panel">
      <div className="panel-header"><div><h2>{filterMessages.title}</h2><p>{filterMessages.intro}</p></div></div>
      <form className="audit-filter-form" method="get">
        <label>{filterMessages.entity}<input name="entityType" defaultValue={filters.entityType ?? ""} maxLength={80} placeholder="requests" /></label>
        <label>{filterMessages.action}<input name="action" defaultValue={filters.action ?? ""} maxLength={80} placeholder="UPDATE" /></label>
        <label>{filterMessages.actor}<input name="actor" defaultValue={filters.actor ?? ""} maxLength={100} /></label>
        <label>{filterMessages.record}<input name="recordId" defaultValue={filters.recordId ?? ""} inputMode="text" maxLength={36} /></label>
        <label>{filterMessages.company}<input className="bidi-ltr" name="companyId" defaultValue={filters.companyId ?? ""} inputMode="text" maxLength={36} /></label>
        <label>{filterMessages.branch}<input className="bidi-ltr" name="branchId" defaultValue={filters.branchId ?? ""} inputMode="text" maxLength={36} /></label>
        <label>{filterMessages.department}<input className="bidi-ltr" name="departmentId" defaultValue={filters.departmentId ?? ""} inputMode="text" maxLength={36} /></label>
        <label>{filterMessages.request}<input className="bidi-ltr" name="requestId" defaultValue={filters.requestId ?? ""} inputMode="text" maxLength={36} /></label>
        <label>{filterMessages.delivery}<input className="bidi-ltr" name="deliveryId" defaultValue={filters.deliveryId ?? ""} inputMode="text" maxLength={36} /></label>
        <label>{filterMessages.outcome}<select name="outcome" defaultValue={filters.outcome ?? ""}><option value="">—</option><option value="SUCCESS">SUCCESS</option><option value="FAILURE">FAILURE</option></select></label>
        <label>{filterMessages.from}<input name="from" type="date" defaultValue={filters.from ?? ""} /></label>
        <label>{filterMessages.to}<input name="to" type="date" defaultValue={filters.to ?? ""} /></label>
        <div className="audit-filter-actions"><button className="button button-primary" type="submit">{filterMessages.apply}</button><Link className="button button-secondary" href="/audit">{filterMessages.clear}</Link></div>
      </form>
    </section>
    <section className="panel"><div className="panel-header"><div><h2>{m("audit.recent")}</h2><p>{filterMessages.result.replace("{count}", new Intl.NumberFormat(locale).format(records.length))} · {m("audit.count")}</p></div><Link className="button button-secondary" href={`/api/export/audit${exportSearch.size ? `?${exportSearch.toString()}` : ""}`}>{filterMessages.export}</Link></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>{m("audit.when")}</th><th>{m("audit.entity")}</th><th>{m("audit.action")}</th><th>{m("audit.record")}</th><th>{m("audit.user")}</th><th>{filterMessages.role}</th><th>{filterMessages.scope}</th><th>{m("audit.reason")}</th><th>{filterMessages.integrity}</th></tr></thead><tbody>{records.length ? records.map((item) => <tr key={item.id}><td>{formatDateTime(item.occurredAt, locale, actor.timezone)}</td><td>{item.eventType ?? item.entityType}</td><td>{item.action}<br /><span className="subtle">{item.outcome}</span></td><td><bdi className="subtle bidi-ltr" dir="ltr">{item.recordId || "—"}</bdi></td><td>{item.actorName || m("common.systemMigration")}</td><td>{item.actorRole || "—"}</td><td><bdi className="subtle bidi-ltr" dir="ltr">{item.departmentId ?? item.branchId ?? item.companyId ?? "PLATFORM"}</bdi></td><td>{item.reasonCode ? <><strong>{item.reasonCode}</strong><br /></> : null}{item.reason || "—"}</td><td><bdi className="subtle bidi-ltr" dir="ltr">{item.integrityHash?.slice(0, 12) ?? "—"}</bdi></td></tr>) : <tr><td colSpan={9}>{m("audit.empty")}</td></tr>}</tbody></table></div></section>
  </>;
}
