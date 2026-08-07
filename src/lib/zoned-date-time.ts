const LOCAL_DATE_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

interface LocalDateTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export class InvalidZonedDateTimeError extends Error {
  constructor() {
    super("The local date, time, or timezone is invalid or ambiguous.");
    this.name = "InvalidZonedDateTimeError";
  }
}

function utcEpoch(parts: LocalDateTimeParts) {
  const value = new Date(0);
  value.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  value.setUTCHours(parts.hour, parts.minute, parts.second, 0);
  return value.getTime();
}

function sameParts(left: LocalDateTimeParts, right: LocalDateTimeParts) {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute
    && left.second === right.second;
}

function assertCalendarParts(parts: LocalDateTimeParts) {
  if (parts.year < 1970 || parts.year > 9999
    || parts.month < 1 || parts.month > 12
    || parts.day < 1 || parts.day > 31
    || parts.hour < 0 || parts.hour > 23
    || parts.minute < 0 || parts.minute > 59
    || parts.second < 0 || parts.second > 59) {
    throw new InvalidZonedDateTimeError();
  }
  const roundTrip = new Date(utcEpoch(parts));
  const normalized: LocalDateTimeParts = {
    year: roundTrip.getUTCFullYear(),
    month: roundTrip.getUTCMonth() + 1,
    day: roundTrip.getUTCDate(),
    hour: roundTrip.getUTCHours(),
    minute: roundTrip.getUTCMinutes(),
    second: roundTrip.getUTCSeconds(),
  };
  if (!sameParts(parts, normalized)) throw new InvalidZonedDateTimeError();
}

function formatter(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new InvalidZonedDateTimeError();
  }
}

function partsInZone(
  value: Date,
  timeZone: string,
): LocalDateTimeParts {
  if (!Number.isFinite(value.getTime())) throw new InvalidZonedDateTimeError();
  const values = new Map(
    formatter(timeZone).formatToParts(value)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)]),
  );
  const result: LocalDateTimeParts = {
    year: values.get("year") ?? Number.NaN,
    month: values.get("month") ?? Number.NaN,
    day: values.get("day") ?? Number.NaN,
    hour: values.get("hour") ?? Number.NaN,
    minute: values.get("minute") ?? Number.NaN,
    second: values.get("second") ?? Number.NaN,
  };
  if (Object.values(result).some((part) => !Number.isInteger(part))) {
    throw new InvalidZonedDateTimeError();
  }
  return result;
}

function parseParts(value: string): LocalDateTimeParts {
  const match = LOCAL_DATE_TIME_PATTERN.exec(value.trim());
  if (!match) throw new InvalidZonedDateTimeError();
  const parts: LocalDateTimeParts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? 0),
  };
  assertCalendarParts(parts);
  return parts;
}

/**
 * Interpret an HTML datetime-local value in one IANA timezone.
 *
 * The iterative offset calculation avoids relying on the host/container
 * timezone. Nonexistent daylight-saving times and ambiguous repeated times are
 * rejected rather than silently extending or shortening a security boundary.
 */
export function parseZonedDateTime(
  value: string,
  timeZone: string,
) {
  const desired = parseParts(value);
  const desiredEpoch = utcEpoch(desired);
  let candidateEpoch = desiredEpoch;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = partsInZone(new Date(candidateEpoch), timeZone);
    const adjustment = desiredEpoch - utcEpoch(observed);
    candidateEpoch += adjustment;
    if (adjustment === 0) break;
  }

  const candidate = new Date(candidateEpoch);
  if (!sameParts(partsInZone(candidate, timeZone), desired)) {
    throw new InvalidZonedDateTimeError();
  }

  // A repeated local time can map to two UTC instants during a backward clock
  // transition. Search the practical DST transition window in 15-minute steps
  // and fail closed when another instant renders as the same local time.
  for (let minutes = -180; minutes <= 180; minutes += 15) {
    if (minutes === 0) continue;
    const alternative = new Date(candidateEpoch + minutes * 60_000);
    if (sameParts(partsInZone(alternative, timeZone), desired)) {
      throw new InvalidZonedDateTimeError();
    }
  }

  return candidate;
}

export function formatZonedDateTimeInput(
  value: Date,
  timeZone: string,
) {
  const parts = partsInZone(value, timeZone);
  const pad = (component: number) => String(component).padStart(2, "0");
  return `${String(parts.year).padStart(4, "0")}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export const zonedDateTimeInternals = {
  partsInZone,
  parseParts,
  sameParts,
  utcEpoch,
};