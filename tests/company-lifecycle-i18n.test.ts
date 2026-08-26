import { describe, expect, it } from "vitest";
import { COMPANY_LIFECYCLE_STATUSES } from "@/lib/company-lifecycle";
import {
  companyLifecycleCountText,
  companyLifecycleMessages,
  companyLifecycleStatusFilters,
  resolveCompanyLifecycleStatusFilter,
} from "@/lib/company-lifecycle-i18n";

describe("simplified company lifecycle register copy", () => {
  it("groups every visible lifecycle state once without exposing duplicate legacy filters", () => {
    const expected = COMPANY_LIFECYCLE_STATUSES.filter((status) => status !== "ARCHIVED").sort();
    const filters = companyLifecycleStatusFilters("en");
    const represented = filters.flatMap((filter) => [...filter.statuses]).sort();

    expect(represented).toEqual(expected);
    expect(new Set(represented).size).toBe(represented.length);
    expect(resolveCompanyLifecycleStatusFilter("ONBOARDING")?.value).toBe("SETUP");
    expect(resolveCompanyLifecycleStatusFilter("ACTIVE")?.value).toBe("ACTIVE");
    expect(resolveCompanyLifecycleStatusFilter("REJECTED")?.value).toBe("INACTIVE");
    expect(resolveCompanyLifecycleStatusFilter("ARCHIVED")).toBeUndefined();
  });

  it("uses unique localized filter labels in English, Arabic and Malay", () => {
    for (const locale of ["en", "ar", "ms"] as const) {
      const labels = companyLifecycleStatusFilters(locale).map((filter) => filter.label);
      expect(new Set(labels).size).toBe(labels.length);
    }
  });

  it("localizes singular counts and the setup action", () => {
    expect(companyLifecycleCountText("en", 1)).toBe("1 company");
    expect(companyLifecycleCountText("en", 2)).toBe("2 companies");
    expect(companyLifecycleCountText("ar", 1)).toBe("1 شركة");
    expect(companyLifecycleCountText("ms", 1)).toBe("1 syarikat");
    expect(companyLifecycleMessages("ar").continueSetup).toBe("متابعة الإعداد");
    expect(companyLifecycleMessages("ms").continueSetup).toBe("Teruskan persediaan");
  });
});
