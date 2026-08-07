import { describe, expect, it } from "vitest";
import {
  ACCESS_ADMINISTRATION_MESSAGES,
  accessAdministrationMessages,
  accessAdministrationNotice,
  localizedAccessChangeType,
} from "@/lib/access-administration-i18n";

describe("access administration localization", () => {
  it("provides complete English, Arabic, and Malay administration copy", () => {
    expect(Object.keys(ACCESS_ADMINISTRATION_MESSAGES).sort())
      .toEqual(["ar", "en", "ms"]);
    for (const locale of ["en", "ar", "ms"] as const) {
      const copy = accessAdministrationMessages(locale);
      expect(copy.title("Test user")).toContain("Test user");
      expect(copy.openAccess.length).toBeGreaterThan(2);
      expect(copy.applyOverrideDescription.length).toBeGreaterThan(20);
      expect(copy.scopeTypes.DEPARTMENT.length).toBeGreaterThan(2);
      expect(accessAdministrationNotice(locale, "override-applied"))
        .toBe(copy.notices["override-applied"]);
      expect(localizedAccessChangeType(locale, "ROLE_REVOKED"))
        .toBe(copy.changeTypes.ROLE_REVOKED);
    }
  });

  it("does not invent a message for an unknown notice and safely labels unknown history events", () => {
    expect(accessAdministrationNotice("en", "not-real")).toBeUndefined();
    expect(localizedAccessChangeType("en", "CUSTOM_EVENT"))
      .toBe("custom event");
  });
});