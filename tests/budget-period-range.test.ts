import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BudgetPeriodScheduleFields } from "@/components/BudgetPeriodScheduleFields";
import { budgetPeriodScheduleFieldInternals } from "@/components/BudgetPeriodScheduleFields";
import { budgetCycleVarianceMessages } from "@/lib/budget-cycle-variance-i18n";
import {
  customBudgetPeriodDefaults,
  deriveBudgetPeriodScheduleFields,
  deriveCustomBudgetPeriodRange,
  isoDateInTimeZone,
  isoLocalDateTimeInTimeZone,
} from "@/lib/budget-period-range";

describe("custom budget period date ranges", () => {
  it("maps an inclusive Mar-to-Dec selection to the existing CUSTOM recurrence", () => {
    expect(deriveCustomBudgetPeriodRange("2026-03-01", "2026-12-31")).toEqual({
      startDate: "2026-03-01",
      endDate: "2026-12-31",
      nextBoundaryDate: "2027-01-01",
      customIntervalDays: 306,
      anchorLocal: "2026-03-01T00:00",
      effectiveLocal: "2026-03-01T00:00",
    });
  });

  it("accepts one day and rejects reverse, impossible, and oversized ranges", () => {
    expect(deriveCustomBudgetPeriodRange("2028-02-29", "2028-02-29").customIntervalDays)
      .toBe(1);
    expect(() => deriveCustomBudgetPeriodRange("2026-04-02", "2026-04-01"))
      .toThrow(/must not precede/i);
    expect(() => deriveCustomBudgetPeriodRange("2026-02-30", "2026-03-01"))
      .toThrow(/date is invalid/i);
    expect(() => deriveCustomBudgetPeriodRange("2026-01-01", "2037-01-01"))
      .toThrow(/between 1 and 3660/i);
  });

  it("derives CUSTOM values server-side and ignores forged anchor semantics", () => {
    expect(deriveBudgetPeriodScheduleFields({
      frequency: "CUSTOM",
      intervalCount: 52,
      periodStartDate: "2026-09-01",
      periodEndDate: "2026-09-10",
      anchorLocal: "2099-01-01T00:00",
      effectiveLocal: "2099-01-01T00:00",
    })).toEqual({
      intervalCount: 1,
      customIntervalDays: 10,
      anchorLocal: "2026-09-01T00:00",
      effectiveLocal: "2026-09-01T00:00",
    });
  });

  it("keeps every-N-month and yearly schedules unchanged", () => {
    expect(deriveBudgetPeriodScheduleFields({
      frequency: "MONTHLY",
      intervalCount: 10,
      periodStartDate: "2099-01-01",
      periodEndDate: "2099-01-02",
      anchorLocal: "2026-09-01T08:30",
      effectiveLocal: "2026-10-01T00:00",
    })).toEqual({
      intervalCount: 10,
      customIntervalDays: undefined,
      anchorLocal: "2026-09-01T08:30",
      effectiveLocal: "2026-10-01T00:00",
    });
    expect(deriveBudgetPeriodScheduleFields({
      frequency: "YEARLY",
      intervalCount: 2,
      anchorLocal: "2026-09-01T08:30",
    }).intervalCount).toBe(2);
  });

  it("uses the account timezone and current cycle length for safe next-period defaults", () => {
    expect(isoDateInTimeZone("2026-08-31T17:00:00.000Z", "Asia/Kuala_Lumpur"))
      .toBe("2026-09-01");
    expect(isoLocalDateTimeInTimeZone(
      "2026-08-31T17:30:00.000Z",
      "Asia/Kuala_Lumpur",
    )).toBe("2026-09-01T01:30");
    expect(customBudgetPeriodDefaults({
      nextRefreshAt: "2026-08-31T17:00:00.000Z",
      timezone: "Asia/Kuala_Lumpur",
      currentCustomIntervalDays: 10,
    })).toEqual({ startDate: "2026-09-01", endDate: "2026-09-10" });
  });
});

describe("budget period range interface", () => {
  function markup(locale: "en" | "ar" | "ms", frequency: "CUSTOM" | "MONTHLY") {
    return renderToStaticMarkup(createElement(BudgetPeriodScheduleFields, {
      defaultFrequency: frequency,
      defaultIntervalCount: frequency === "MONTHLY" ? 10 : 1,
      defaultAnchorLocal: "2026-09-01T00:00",
      defaultEffectiveLocal: "2026-09-01T00:00",
      minimumStartDate: "2026-09-01",
      defaultStartDate: "2026-09-01",
      defaultEndDate: "2026-09-10",
      locale,
      messages: budgetCycleVarianceMessages(locale),
    }));
  }

  it("renders an accessible inclusive range and a visible recurrence summary", () => {
    const html = markup("en", "CUSTOM");
    expect(html).toContain("Custom period date range");
    expect(html).toContain('name="periodStartDate"');
    expect(html).toContain('name="periodEndDate"');
    expect(html).toContain('aria-label="Custom period date range"');
    expect(html).toContain('role="grid"');
    expect(html).toContain('type="hidden" name="periodStartDate" value="2026-09-01"');
    expect(html).not.toContain('type="date"');
    expect(html).toMatch(/name="customIntervalDays" value="10"/);
    expect(html).toContain('role="status"');
    expect(html).toContain("10 calendar days");
    expect(html).toContain("next reset");
    expect(html).not.toMatch(/name="customIntervalDays"[^>]*type="number"/);
  });

  it("round-trips calendar dates without a UTC timezone shift", () => {
    const date = budgetPeriodScheduleFieldInternals.isoDateToLocalCalendarDate("2028-02-29");
    expect(date).toBeInstanceOf(Date);
    expect(budgetPeriodScheduleFieldInternals.localCalendarDateToIso(date as Date))
      .toBe("2028-02-29");
    expect(budgetPeriodScheduleFieldInternals.isoDateToLocalCalendarDate("2026-02-30"))
      .toBeUndefined();
  });

  it("keeps an every-10-month schedule and localized copy in all locales", () => {
    const english = markup("en", "MONTHLY");
    expect(english).toMatch(/name="intervalCount"[^>]*value="10"/);
    expect(english).toContain("10-month cycle");
    expect(english).not.toContain('name="periodStartDate"');

    expect(markup("ar", "CUSTOM")).toContain("نطاق فترة الميزانية المخصصة");
    expect(markup("ms", "CUSTOM")).toContain("Julat tarikh tempoh tersuai");
  });
});
