import { describe, expect, it } from "vitest";
import { dashboardPeriodMessages } from "@/lib/dashboard-period-i18n";

describe("P1-15 dashboard period localization", () => {
  it("provides complete English, Arabic, and Malay controls and errors", () => {
    const catalogs = ["en", "ar", "ms"].map((locale) => (
      dashboardPeriodMessages(locale as "en" | "ar" | "ms")
    ));
    for (const copy of catalogs) {
      expect(Object.keys(copy.presets)).toHaveLength(7);
      expect(Object.keys(copy.issues)).toHaveLength(4);
      expect(copy.title).not.toBe("");
      expect(copy.compare).not.toBe("");
      expect(copy.export).not.toBe("");
      expect(copy.currentSnapshot).not.toBe("");
    }
    expect(catalogs[0].title).not.toBe(catalogs[1].title);
    expect(catalogs[0].title).not.toBe(catalogs[2].title);
  });
});
