import { describe, expect, it } from "vitest";
import {
  InvalidZonedDateTimeError,
  formatZonedDateTimeInput,
  parseZonedDateTime,
} from "@/lib/zoned-date-time";

describe("timezone-safe local date and time parsing", () => {
  it("interprets Malaysian administration input independently of the host timezone", () => {
    expect(parseZonedDateTime(
      "2026-08-08T09:30",
      "Asia/Kuala_Lumpur",
    ).toISOString()).toBe("2026-08-08T01:30:00.000Z");
    expect(formatZonedDateTimeInput(
      new Date("2026-08-08T01:30:00.000Z"),
      "Asia/Kuala_Lumpur",
    )).toBe("2026-08-08T09:30");
  });

  it("uses the correct seasonal offset for an IANA timezone", () => {
    expect(parseZonedDateTime(
      "2026-01-15T09:30",
      "America/New_York",
    ).toISOString()).toBe("2026-01-15T14:30:00.000Z");
    expect(parseZonedDateTime(
      "2026-07-15T09:30",
      "America/New_York",
    ).toISOString()).toBe("2026-07-15T13:30:00.000Z");
  });

  it("rejects invalid calendar values, unknown zones, DST gaps, and repeated times", () => {
    for (const [value, zone] of [
      ["2026-02-30T09:30", "Asia/Kuala_Lumpur"],
      ["2026-08-08 09:30", "Asia/Kuala_Lumpur"],
      ["2026-08-08T09:30", "Not/A_Timezone"],
      ["2026-03-08T02:30", "America/New_York"],
      ["2026-11-01T01:30", "America/New_York"],
    ] as const) {
      expect(() => parseZonedDateTime(value, zone))
        .toThrow(InvalidZonedDateTimeError);
    }
  });
});