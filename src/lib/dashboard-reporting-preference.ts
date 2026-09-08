import { z } from "zod";

import {
  DASHBOARD_PERIOD_PRESETS,
  type DashboardPeriodInput,
  type DashboardPeriodPreset,
} from "./dashboard-period";

export const DASHBOARD_REPORTING_PREFERENCE_COOKIE = "axora_dashboard_reporting";
export const DASHBOARD_REPORTING_PREFERENCE_MAX_AGE = 60 * 60 * 24 * 180;

export function dashboardReportingPreferenceCookieOptions(maxAge: number) {
  return {
    path: "/" as const,
    maxAge,
    sameSite: "lax" as const,
    httpOnly: true,
    // Release-parity E2E runs the standalone production artifact on local
    // HTTP with database-disabled demo data. Every non-demo runtime keeps
    // this authenticated preference cookie Secure by default.
    secure: process.env.NODE_ENV === "production" && process.env.DEMO_MODE !== "true",
  };
}

export type DashboardReportingPreference = {
  preset: DashboardPeriodPreset;
  start?: string;
  end?: string;
  branchId?: string;
};

type StoredPreference = DashboardReportingPreference & { updatedAt: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const storedPreferenceSchema = z.object({
  preset: z.enum(DASHBOARD_PERIOD_PRESETS),
  start: z.string().regex(ISO_DATE).optional(),
  end: z.string().regex(ISO_DATE).optional(),
  branchId: z.uuid().optional(),
  updatedAt: z.string().datetime(),
}).strict();
const preferenceEnvelopeSchema = z.object({
  version: z.literal(1),
  preferences: z.record(z.uuid(), storedPreferenceSchema),
}).strict();

function parseEnvelope(value: string | undefined) {
  if (!value) return { version: 1 as const, preferences: {} as Record<string, StoredPreference> };
  try {
    const parsed = preferenceEnvelopeSchema.safeParse(JSON.parse(value));
    return parsed.success
      ? parsed.data
      : { version: 1 as const, preferences: {} as Record<string, StoredPreference> };
  } catch {
    return { version: 1 as const, preferences: {} as Record<string, StoredPreference> };
  }
}

export function dashboardReportingPreferenceForUser(
  value: string | undefined,
  userId: string,
): DashboardReportingPreference | undefined {
  if (!z.uuid().safeParse(userId).success) return undefined;
  const preference = parseEnvelope(value).preferences[userId];
  if (!preference) return undefined;
  return {
    preset: preference.preset,
    ...(preference.start ? { start: preference.start } : {}),
    ...(preference.end ? { end: preference.end } : {}),
    ...(preference.branchId ? { branchId: preference.branchId } : {}),
  };
}

export function dashboardReportingPreferenceInput(
  preference: DashboardReportingPreference | undefined,
): DashboardPeriodInput {
  if (!preference) return {};
  return {
    preset: preference.preset,
    ...(preference.start ? { start: preference.start } : {}),
    ...(preference.end ? { end: preference.end } : {}),
  };
}

export function serializeDashboardReportingPreference(
  value: string | undefined,
  userId: string,
  preference: DashboardReportingPreference,
  updatedAt = new Date().toISOString(),
) {
  if (!z.uuid().safeParse(userId).success) return undefined;
  const parsed = storedPreferenceSchema.safeParse({ ...preference, updatedAt });
  if (!parsed.success) return undefined;
  const preferences = {
    ...parseEnvelope(value).preferences,
    [userId]: parsed.data,
  };
  const retained = Object.fromEntries(Object.entries(preferences)
    .sort(([, left], [, right]) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, 20));
  return JSON.stringify({ version: 1, preferences: retained });
}

export function clearDashboardReportingPreference(value: string | undefined, userId: string) {
  const envelope = parseEnvelope(value);
  delete envelope.preferences[userId];
  return Object.keys(envelope.preferences).length
    ? JSON.stringify(envelope)
    : undefined;
}

export function hasExplicitDashboardReportingFilters(
  input: Record<string, string | string[] | undefined>,
) {
  return ["preset", "start", "end", "branch"].some((key) => input[key] !== undefined);
}
