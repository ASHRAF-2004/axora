import { requireSession } from "@/lib/auth";
import {
  DASHBOARD_METRIC_DEFINITIONS,
  normalizeDashboardPeriod,
  type DashboardPeriodInput,
} from "@/lib/dashboard-period";
import { dashboardPeriodMessages } from "@/lib/dashboard-period-i18n";
import {
  getAuthorizedDashboardPeriodReport,
  resolveDashboardReportingScope,
} from "@/lib/dashboard-reader";
import { canAccess } from "@/lib/permissions";
import type { NextRequest } from "next/server";

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\r\n]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}

function row(...values: unknown[]) {
  return values.map(csvCell).join(",");
}

function inputFromRequest(request: NextRequest): DashboardPeriodInput {
  return {
    preset: request.nextUrl.searchParams.get("preset") ?? undefined,
    start: request.nextUrl.searchParams.get("start") ?? undefined,
    end: request.nextUrl.searchParams.get("end") ?? undefined,
    compare: request.nextUrl.searchParams.get("compare") ?? undefined,
  };
}

export async function GET(request: NextRequest) {
  const actor = await requireSession();
  if (!canAccess(actor, "view_dashboard")) {
    return new Response(null, { status: 404 });
  }

  try {
    const scope = await resolveDashboardReportingScope(
      actor,
      request.nextUrl.searchParams.get("branch") ?? undefined,
    );
    const period = normalizeDashboardPeriod(inputFromRequest(request), scope.timeZone);
    const report = await getAuthorizedDashboardPeriodReport(
      actor,
      period,
      scope,
      "Exported authorized dashboard period",
    );
    const locale = actor.preferredLocale ?? "en";
    const copy = dashboardPeriodMessages(locale);
    const current = report.current as unknown as Record<string, unknown>;
    const previous = report.previous as unknown as Record<string, unknown> | undefined;

    if (report.scope === "company") {
      const branches = scope.directory.branches.filter((branch) => (
        (!scope.branchId || branch.id === scope.branchId)
        && branch.canViewBudget
        && branch.monthlyBudget != null
      ));
      current.monthlyBudget = branches.reduce(
        (sum, branch) => sum + (branch.monthlyBudget ?? 0),
        0,
      );
      current.remainingBudget = branches.reduce(
        (sum, branch) => sum + (branch.remainingAmount ?? 0),
        0,
      );
    }

    const lines = [
      row("record_type", "key", "current_value", "previous_value", "detail"),
      row("metadata", "scope", report.scope, "", scope.branchName ?? "all-authorized"),
      row("metadata", "preset", period.preset, "", copy.presets[period.preset]),
      row("metadata", "start_inclusive", period.startDate, "", period.timeZone),
      row("metadata", "end_exclusive", period.endExclusiveDate, "", period.timeZone),
      row("metadata", "displayed_end_inclusive", period.endDate, "", period.timeZone),
      row("metadata", "generated_at", period.generatedAt, "", period.timeZone),
      row("metadata", "locale", locale, "", "Saved profile locale"),
      row("metadata", "comparison", period.compare, "", period.comparison
        ? period.comparison.startDate + "/" + period.comparison.endExclusiveDate
        : "disabled"),
      row("metadata", "date_semantics", "inclusive_start_exclusive_end", "", "PostgreSQL AT TIME ZONE"),
      row("metadata", "freshness", "live", "", "No shared dashboard cache"),
    ];
    for (const definition of DASHBOARD_METRIC_DEFINITIONS) {
      if (definition.scope !== "both" && definition.scope !== report.scope) continue;
      lines.push(row(
        "metric",
        definition.key,
        current[definition.key],
        previous?.[definition.key],
        definition.meaning + " | " + definition.dateField + " | " + definition.statuses,
      ));
    }

    const body = "\uFEFF" + lines.join("\r\n") + "\r\n";
    const filename = "axora-dashboard-" + period.startDate + "-" + period.endDate + ".csv";
    return new Response(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="' + filename + '"',
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
