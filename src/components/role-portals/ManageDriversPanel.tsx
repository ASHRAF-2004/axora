"use client";

import Link from "next/link";
import { useState } from "react";
import { useLiveRead } from "@/components/LiveUpdatesProvider";
import type { DriverManagementWorkspace } from "@/lib/driver-operations";
import {
  driverAvailabilityLabel,
  driverManagementMessages,
} from "@/lib/driver-management-i18n";
import { deliveryWorkflowStatusLabel } from "@/lib/delivery-workflow-i18n";
import type { SupportedLocale } from "@/lib/i18n";

export function ManageDriversPanel({
  initialWorkspace,
  locale = "en",
  timeZone = "Asia/Kuala_Lumpur",
}: {
  initialWorkspace: DriverManagementWorkspace;
  locale?: SupportedLocale;
  timeZone?: string;
}) {
  const copy = driverManagementMessages(locale);
  const [workspace, setWorkspace] = useState(initialWorkspace);
  useLiveRead<DriverManagementWorkspace>("drivers", "/api/drivers", setWorkspace);
  return <section className="panel"><div className="data-table-wrap"><table className="data-table"><thead><tr><th>{copy.driver}</th><th>{copy.state}</th><th>{copy.availability}</th><th>{copy.current}</th><th>{copy.completed}</th><th>{copy.location}</th></tr></thead><tbody>
    {workspace.drivers.map((driver) => <tr key={driver.id}><td><Link href={`/deliveries/drivers/${driver.id}`}><strong>{driver.name}</strong></Link><br /><span className="subtle">{driver.email} · {driver.phone}</span></td><td>{driver.active ? copy.active : copy.deactivated}</td><td>{driverAvailabilityLabel(driver.availability, locale)}</td><td>{driver.currentJobCode ?? "—"}<br /><span className="subtle">{driver.currentJobStatus ? deliveryWorkflowStatusLabel(driver.currentJobStatus, locale) : copy.none}</span></td><td>{driver.completedJobs}</td><td>{driver.lastLocationAt ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(driver.lastLocationAt)) : copy.noLocation}<br /><span className="subtle">{driver.locationStale ? copy.stale : `±${Math.round(driver.lastAccuracy ?? 0)} m`}</span></td></tr>)}
  </tbody></table></div></section>;
}
