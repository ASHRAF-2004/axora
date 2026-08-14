"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AvailableDeliveryWorkspace } from "@/lib/driver-operations";
import type { SupportedLocale } from "@/lib/i18n";

const copy = {
  en: { title: "Available delivery jobs", intro: "Claim one paid job when you are ready. The first eligible Delivery Guy to claim it wins.", claim: "Claim", empty: "No paid jobs are available.", conflict: "This job was already claimed.", live: "Live", offline: "Reconnecting", availability: "Availability", available: "Available", unavailable: "Unavailable", job: "Job", company: "Company", area: "Area", items: "Items" },
  ar: { title: "مهام التسليم المتاحة", intro: "اختر مهمة مدفوعة عندما تكون مستعداً. يحصل عليها أول مسؤول توصيل مؤهل.", claim: "اختيار المهمة", empty: "لا توجد مهام مدفوعة متاحة.", conflict: "تم اختيار هذه المهمة بالفعل.", live: "مباشر", offline: "إعادة الاتصال", availability: "التوفر", available: "متاح", unavailable: "غير متاح", job: "المهمة", company: "الشركة", area: "المنطقة", items: "البنود" },
  ms: { title: "Kerja penghantaran tersedia", intro: "Tuntut satu kerja berbayar apabila bersedia. Delivery Guy pertama yang layak akan mendapatnya.", claim: "Tuntut", empty: "Tiada kerja berbayar tersedia.", conflict: "Kerja ini telah dituntut.", live: "Langsung", offline: "Menyambung semula", availability: "Ketersediaan", available: "Tersedia", unavailable: "Tidak tersedia", job: "Kerja", company: "Syarikat", area: "Kawasan", items: "Item" },
};

export function AvailableDeliveryJobs({ locale = "en" }: { locale?: SupportedLocale }) {
  const text = copy[locale];
  const [workspace, setWorkspace] = useState<AvailableDeliveryWorkspace | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const connectedRef = useRef(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/driver/jobs", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error("unavailable");
    setWorkspace(await response.json() as AvailableDeliveryWorkspace);
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    const setLive = (value: boolean) => { connectedRef.current = value; setConnected(value); };
    const connect = () => {
      if (document.hidden || source) return;
      void refresh().catch(() => setLive(false));
      source = new EventSource("/api/driver/jobs/live", { withCredentials: true });
      source.addEventListener("snapshot", ((event: MessageEvent<string>) => {
        try {
          const envelope = JSON.parse(event.data) as { sequence: number; snapshot: AvailableDeliveryWorkspace };
          if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence <= sequence.current) return;
          sequence.current = envelope.sequence;
          setWorkspace(envelope.snapshot);
          setLive(true);
        } catch { setLive(false); }
      }) as EventListener);
      // EventSource performs a standards-based reconnect and the first event is
      // always an authoritative snapshot. Do not close it on a transient error.
      source.onerror = () => setLive(false);
    };
    const fallback = window.setInterval(() => {
      if (!connectedRef.current && document.visibilityState === "visible" && navigator.onLine) void refresh();
    }, 30_000);
    const visibility = () => { if (document.hidden) { source?.close(); source = null; setLive(false); } else connect(); };
    const online = () => connect();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    connect();
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("online", online); source?.close(); window.clearInterval(fallback); };
  }, [refresh]);

  async function availability(value: "AVAILABLE" | "UNAVAILABLE") {
    await fetch("/api/driver/availability", {
      method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ availability: value }),
    });
    await refresh();
  }

  async function claim(jobId: string) {
    setBusy(jobId); setError("");
    try {
      const response = await fetch("/api/driver/jobs", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, commandId: crypto.randomUUID() }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || text.conflict);
      await refresh();
      window.dispatchEvent(new CustomEvent("axora:delivery-claimed"));
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : text.conflict);
    } finally { setBusy(""); }
  }

  return <section className="panel" aria-labelledby="available-delivery-jobs">
    <div className="panel-header"><div><h2 id="available-delivery-jobs">{text.title}</h2><p>{text.intro}</p></div><span className="status-badge">{connected ? text.live : text.offline}</span></div>
    <div className="form-actions" aria-label={text.availability}>
      <button className="button button-secondary" type="button" onClick={() => void availability("AVAILABLE")}>{text.available}</button>
      <button className="button button-secondary" type="button" onClick={() => void availability("UNAVAILABLE")}>{text.unavailable}</button>
    </div>
    {error ? <p className="callout" role="alert">{error}</p> : null}
    {!workspace?.jobs.length ? <p className="subtle">{text.empty}</p> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>{text.job}</th><th>{text.company}</th><th>{text.area}</th><th>{text.items}</th><th /></tr></thead><tbody>
      {workspace.jobs.map((job) => <tr key={job.id}><td><strong>{job.code}</strong><br /><span className="subtle">{job.requestReference}</span></td><td>{job.companyName}<br /><span className="subtle">{job.branchName}</span></td><td>{job.area || "—"}</td><td>{job.lineCount}</td><td><button className="button button-primary" disabled={Boolean(busy)} onClick={() => void claim(job.id)} type="button">{text.claim}</button></td></tr>)}
    </tbody></table></div>}
  </section>;
}
