import { requireSession } from "@/lib/auth";
import {
  clearDashboardReportingPreference,
  dashboardReportingPreferenceCookieOptions,
  DASHBOARD_REPORTING_PREFERENCE_COOKIE,
  DASHBOARD_REPORTING_PREFERENCE_MAX_AGE,
  serializeDashboardReportingPreference,
  type DashboardReportingPreference,
} from "@/lib/dashboard-reporting-preference";
import { dashboardPeriodSearchParams, normalizeDashboardPeriod, type DashboardPeriodInput } from "@/lib/dashboard-period";
import { resolveDashboardReportingScope } from "@/lib/dashboard-reader";
import { canAccess } from "@/lib/permissions";
import { NextRequest, NextResponse } from "next/server";

function first(value: string | null) {
  return value ?? undefined;
}

async function preferenceFor(
  request: NextRequest,
  input: DashboardPeriodInput & { branch?: string; reset?: boolean },
) {
  const actor = await requireSession();
  if (!canAccess(actor, "view_dashboard")) return undefined;
  if (input.reset) return { actor, reset: true as const };
  const scope = await resolveDashboardReportingScope(actor, input.branch);
  const period = normalizeDashboardPeriod(input, scope.timeZone);
  const preference: DashboardReportingPreference = {
    preset: period.preset,
    ...(period.preset === "custom" ? { start: period.startDate, end: period.endDate } : {}),
    ...(scope.branchId ? { branchId: scope.branchId } : {}),
  };
  return { actor, reset: false as const, scope, period, preference };
}

function setPreferenceCookie(
  response: NextResponse,
  request: NextRequest,
  actorId: string,
  preference: DashboardReportingPreference | undefined,
) {
  const existing = request.cookies.get(DASHBOARD_REPORTING_PREFERENCE_COOKIE)?.value;
  const value = preference
    ? serializeDashboardReportingPreference(existing, actorId, preference)
    : clearDashboardReportingPreference(existing, actorId);
  if (!value) {
    response.cookies.set(DASHBOARD_REPORTING_PREFERENCE_COOKIE, "", {
      ...dashboardReportingPreferenceCookieOptions(0),
    });
    return;
  }
  response.cookies.set(DASHBOARD_REPORTING_PREFERENCE_COOKIE, value, {
    ...dashboardReportingPreferenceCookieOptions(DASHBOARD_REPORTING_PREFERENCE_MAX_AGE),
  });
}

export async function GET(request: NextRequest) {
  const parameters = request.nextUrl.searchParams;
  const result = await preferenceFor(request, {
    preset: first(parameters.get("preset")), start: first(parameters.get("start")),
    end: first(parameters.get("end")), branch: first(parameters.get("branch")), reset: parameters.get("reset") === "1",
  });
  if (!result) return new NextResponse(null, { status: 403 });
  const query = result.reset
    ? ""
    : `?${dashboardPeriodSearchParams(result.period, result.scope.branchId).toString()}`;
  const target = new URL(`/dashboard${query}`, request.url);
  const response = NextResponse.redirect(target);
  setPreferenceCookie(response, request, result.actor.id, result.reset ? undefined : result.preference);
  return response;
}

export async function POST(request: NextRequest) {
  let body: DashboardPeriodInput & { branch?: string };
  try {
    body = await request.json() as DashboardPeriodInput & { branch?: string };
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  const result = await preferenceFor(request, body);
  if (!result || result.reset) return new NextResponse(null, { status: 403 });
  const response = new NextResponse(null, { status: 204 });
  setPreferenceCookie(response, request, result.actor.id, result.preference);
  return response;
}
