"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { DriverManagementWorkspace } from "@/lib/driver-operations";
import {
  driverAvailabilityLabel,
  driverManagementMessages,
} from "@/lib/driver-management-i18n";
import { deliveryWorkflowStatusLabel } from "@/lib/delivery-workflow-i18n";
import type { SupportedLocale } from "@/lib/i18n";

export function ManageDriversPanel({ initialWorkspace, locale = "en" }: { initialWorkspace: DriverManagementWorkspace; locale?: SupportedLocale }) {
  const copy = driverManagementMessages(locale);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const sequence = useRef(initialWorkspace.sequence);
  useEffect(() => {
    let source: EventSource | null = null;
    let fallback: number | undefined;
    const load = async () => {
      const response = await fetch("/api/drivers", { cache: "no-store" });
      if (!response.ok) return;
      const next = await response.json() as DriverManagementWorkspace;
      if (next.sequence >= sequence.current) { sequence.current = next.sequence; setWorkspace(next); }
    };
    const connect = () => {
      if (document.hidden || source) return;
      void load();
      if (typeof globalThis.EventSource !== "function") { fallback = window.setInterval(() => void load(), 15_000); return; }
      source = new EventSource("/api/drivers/live");
      source.addEventListener("snapshot", (event) => {
        try {
          const message = JSON.parse((event as MessageEvent<string>).data) as { sequence: number; snapshot: DriverManagementWorkspace };
          if (!Number.isSafeInteger(message.sequence) || message.sequence <= sequence.current) return;
          sequence.current = message.sequence;
          setWorkspace(message.snapshot);
        } catch { /* The reconnect snapshot is authoritative. */ }
      });
      source.onerror = () => { /* Native EventSource reconnects automatically. */ };
    };
    const visibility = () => { if (document.hidden) { source?.close(); source = null; if (fallback) window.clearInterval(fallback); fallback = undefined; } else connect(); };
    const online = () => connect();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    connect();
    return () => { document.removeEventListener("visibilitychange", visibility); window.removeEventListener("online", online); source?.close(); if (fallback) window.clearInterval(fallback); };
  }, []);
  return <section className="panel"><div className="data-table-wrap"><table className="data-table"><thead><tr><th>{copy.driver}</th><th>{copy.state}</th><th>{copy.availability}</th><th>{copy.current}</th><th>{copy.completed}</th><th>{copy.location}</th></tr></thead><tbody>
    {workspace.drivers.map((driver) => <tr key={driver.id}><td><Link href={`/deliveries/drivers/${driver.id}`}><strong>{driver.name}</strong></Link><br /><span className="subtle">{driver.email} · {driver.phone}</span></td><td>{driver.active ? copy.active : copy.deactivated}</td><td>{driverAvailabilityLabel(driver.availability, locale)}</td><td>{driver.currentJobCode ?? "—"}<br /><span className="subtle">{driver.currentJobStatus ? deliveryWorkflowStatusLabel(driver.currentJobStatus, locale) : copy.none}</span></td><td>{driver.completedJobs}</td><td>{driver.lastLocationAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(driver.lastLocationAt)) : copy.noLocation}<br /><span className="subtle">{driver.locationStale ? copy.stale : `±${Math.round(driver.lastAccuracy ?? 0)} m`}</span></td></tr>)}
  </tbody></table></div></section>;
}
