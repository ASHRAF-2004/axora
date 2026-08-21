const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const MILLISECONDS_PER_DAY = 86_400_000;
const MAX_CUSTOM_PERIOD_DAYS = 3_660;

export type BudgetPeriodFrequency =
  | "WEEKLY"
  | "MONTHLY"
  | "QUARTERLY"
  | "YEARLY"
  | "CUSTOM"
  | "MANUAL";

export type CustomBudgetPeriodRange = {
  startDate: string;
  endDate: string;
  nextBoundaryDate: string;
  customIntervalDays: number;
  anchorLocal: string;
  effectiveLocal: string;
};

function calendarDateMilliseconds(value: string) {
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) throw new Error("The custom budget period date is invalid.");

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const milliseconds = Date.UTC(year, month - 1, day);
  const parsed = new Date(milliseconds);

  if (
    parsed.getUTCFullYear() !== year
    || parsed.getUTCMonth() !== month - 1
    || parsed.getUTCDate() !== day
  ) {
    throw new Error("The custom budget period date is invalid.");
  }

  return milliseconds;
}

export function addIsoCalendarDays(value: string, days: number) {
  if (!Number.isSafeInteger(days)) {
    throw new Error("The custom budget period length is invalid.");
  }
  return new Date(calendarDateMilliseconds(value) + days * MILLISECONDS_PER_DAY)
    .toISOString()
    .slice(0, 10);
}

/**
 * Converts the inclusive dates selected by the operator into the existing
 * CUSTOM schedule contract. A 1 Mar -> 31 Dec selection therefore has its
 * next (exclusive) boundary on 1 Jan and repeats after the same number of
 * calendar days. UTC arithmetic is intentional: these are calendar dates,
 * while PostgreSQL resolves the resulting local midnight in the chosen IANA
 * timezone according to the schedule's explicit DST policy.
 */
export function deriveCustomBudgetPeriodRange(
  startDate: string,
  endDate: string,
): CustomBudgetPeriodRange {
  const start = calendarDateMilliseconds(startDate);
  const end = calendarDateMilliseconds(endDate);
  if (end < start) {
    throw new Error("The custom budget period end date must not precede its start date.");
  }

  const customIntervalDays = Math.floor((end - start) / MILLISECONDS_PER_DAY) + 1;
  if (customIntervalDays < 1 || customIntervalDays > MAX_CUSTOM_PERIOD_DAYS) {
    throw new Error("The custom budget period must be between 1 and 3660 days.");
  }

  return {
    startDate,
    endDate,
    nextBoundaryDate: addIsoCalendarDays(endDate, 1),
    customIntervalDays,
    anchorLocal: `${startDate}T00:00`,
    effectiveLocal: `${startDate}T00:00`,
  };
}

function assertLocalDateTime(value: string, optional = false) {
  if (optional && !value) return undefined;
  const match = LOCAL_DATE_TIME_PATTERN.exec(value);
  if (!match) throw new Error("The local budget schedule time is invalid.");

  const [, year, month, day, hour, minute] = match;
  calendarDateMilliseconds(`${year}-${month}-${day}`);
  if (Number(hour) > 23 || Number(minute) > 59) {
    throw new Error("The local budget schedule time is invalid.");
  }
  return value;
}

export function deriveBudgetPeriodScheduleFields(input: {
  frequency: BudgetPeriodFrequency;
  intervalCount: number;
  periodStartDate?: string;
  periodEndDate?: string;
  anchorLocal?: string;
  effectiveLocal?: string;
}) {
  if (input.frequency === "CUSTOM") {
    const range = deriveCustomBudgetPeriodRange(
      input.periodStartDate ?? "",
      input.periodEndDate ?? "",
    );
    return {
      intervalCount: 1,
      customIntervalDays: range.customIntervalDays,
      anchorLocal: range.anchorLocal,
      effectiveLocal: range.effectiveLocal,
    };
  }

  if (!Number.isInteger(input.intervalCount)
    || input.intervalCount < 1
    || input.intervalCount > 52) {
    throw new Error("The budget schedule interval is invalid.");
  }

  return {
    intervalCount: input.intervalCount,
    customIntervalDays: undefined,
    anchorLocal: assertLocalDateTime(input.anchorLocal ?? "") as string,
    effectiveLocal: assertLocalDateTime(input.effectiveLocal ?? "", true),
  };
}

export function isoDateInTimeZone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = valueFor("year");
  const month = valueFor("month");
  const day = valueFor("day");
  if (!year || !month || !day) {
    throw new Error("The budget period date is unavailable.");
  }
  return `${year}-${month}-${day}`;
}

export function isoLocalDateTimeInTimeZone(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const valueFor = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;
  const year = valueFor("year");
  const month = valueFor("month");
  const day = valueFor("day");
  const hour = valueFor("hour");
  const minute = valueFor("minute");
  if (!year || !month || !day || !hour || !minute) {
    throw new Error("The budget period date and time are unavailable.");
  }
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

export function customBudgetPeriodDefaults(input: {
  nextRefreshAt: string;
  timezone: string;
  currentCustomIntervalDays?: number;
}) {
  const startDate = isoDateInTimeZone(input.nextRefreshAt, input.timezone);
  const customIntervalDays = Number.isInteger(input.currentCustomIntervalDays)
    && (input.currentCustomIntervalDays ?? 0) >= 1
    && (input.currentCustomIntervalDays ?? 0) <= MAX_CUSTOM_PERIOD_DAYS
    ? input.currentCustomIntervalDays as number
    : 30;
  return {
    startDate,
    endDate: addIsoCalendarDays(startDate, customIntervalDays - 1),
  };
}

export const budgetPeriodRangeInternals = {
  MAX_CUSTOM_PERIOD_DAYS,
};
