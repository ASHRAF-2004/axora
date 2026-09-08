"use client";

import { useEffect } from "react";

import type { DashboardReportingPreference } from "@/lib/dashboard-reporting-preference";

export function DashboardReportingPreferenceSync({
  preference,
}: {
  preference: DashboardReportingPreference;
}) {
  const value = JSON.stringify({
    preset: preference.preset,
    ...(preference.start ? { start: preference.start } : {}),
    ...(preference.end ? { end: preference.end } : {}),
    ...(preference.branchId ? { branch: preference.branchId } : {}),
  });
  useEffect(() => {
    void fetch("/dashboard/reporting-preference", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: value,
      keepalive: true,
    });
  }, [value]);
  return null;
}
