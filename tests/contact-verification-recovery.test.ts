import { describe, expect, it } from "vitest";
import { contactVerificationFailure, contactVerificationMessages } from "@/lib/contact-verification-i18n";

describe("public Contact verification recovery", () => {
  it("classifies the reported challenge failure without claiming an application or tunnel outage", () => {
    expect(contactVerificationFailure("600010")).toEqual({ kind: "failed", code: "600010", retry: true });
  });
  it.each(["110100", "110110", "110200", "200100", "400020", "400021", "400070"])("does not offer blind retry for configuration code %s", (code) => {
    expect(contactVerificationFailure(code)).toEqual({ kind: "configuration", code, retry: false });
  });
  it.each(["110600", "110620"])("offers explicit retry for timeout %s", (code) => {
    expect(contactVerificationFailure(code)).toEqual({ kind: "timeout", code, retry: true });
  });
  it.each([undefined, null, {}, 600010, "secret-or-token", "600010\nprivate diagnostic", "<script>alert(1)</script>"])("never renders arbitrary provider data", (value) => {
    expect(contactVerificationFailure(value).code).toBeNull();
  });
  it.each(["en", "ar", "ms"] as const)("provides complete %s recovery copy", (locale) => {
    const copy = contactVerificationMessages(locale);
    expect(Object.keys(copy)).toHaveLength(8);
    for (const value of Object.values(copy)) expect(value.length).toBeGreaterThan(3);
  });
});
