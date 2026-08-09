import { describe, expect, it } from "vitest";
import { companyBrandingMessages } from "@/lib/company-branding-i18n";

describe("company branding localization", () => {
  it.each(["en", "ar", "ms"] as const)(
    "has complete %s review, contrast, workflow, and rollback copy",
    (locale) => {
      const copy = companyBrandingMessages(locale);
      expect(copy.title).toBeTruthy();
      expect(copy.previewTitle).toBeTruthy();
      expect(copy.contrastTitle).toBeTruthy();
      expect(copy.rollback).toBeTruthy();
      expect(Object.keys(copy.status).sort()).toEqual([
        "APPROVED",
        "PUBLISHED",
        "REJECTED",
        "REVIEW_REQUIRED",
        "SUPERSEDED",
      ]);
      expect(Object.keys(copy.quality).sort()).toEqual([
        "FALLBACK_PALETTE",
        "LOW_RESOLUTION",
        "MONOCHROME",
        "TRANSPARENCY",
      ]);
    },
  );
});
