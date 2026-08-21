import { describe, expect, it } from "vitest";

import { PERMISSION_CATALOG } from "@/lib/authorization-policy";
import { localizePermissionOption } from "@/lib/permission-catalog-i18n";

describe("permission catalogue localization", () => {
  it("keeps canonical English metadata and localizes every Arabic and Malay option", () => {
    for (const option of PERMISSION_CATALOG) {
      expect(localizePermissionOption(option, "en")).toBe(option);
      for (const locale of ["ar", "ms"] as const) {
        const localized = localizePermissionOption(option, locale);
        expect(localized.code).toBe(option.code);
        expect(localized.group).not.toBe("");
        expect(localized.label).not.toContain("Kebenaran operasi (");
        expect(localized.label).not.toContain("صلاحية تشغيلية (");
        expect(localized.description).not.toBe(option.description);
      }
    }
  });

  it("uses clear localized language for sensitive Prompt 7 capabilities", () => {
    const record = PERMISSION_CATALOG.find((item) => (
      item.code === "finance.wallet.top_up.record"
    ));
    const claim = PERMISSION_CATALOG.find((item) => item.code === "delivery.claim");
    expect(record).toBeDefined();
    expect(claim).toBeDefined();
    expect(localizePermissionOption(record!, "ar").label).toContain("تسجيل");
    expect(localizePermissionOption(record!, "ms").label).toContain("Rekod");
    expect(localizePermissionOption(claim!, "ar").label).toContain("استلام");
    expect(localizePermissionOption(claim!, "ms").label).toContain("Tuntut");
  });
});
