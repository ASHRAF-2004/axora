import { describe, expect, it } from "vitest";
import {
  EMAIL_COMPLETION_PROVIDER_NAMES,
  normalizeEmailCompletionProviderName,
} from "@/lib/email-completion-provider";

describe("email completion provider validation", () => {
  it("accepts only the current Resend path plus test/unconfigured states", () => {
    expect(EMAIL_COMPLETION_PROVIDER_NAMES).toEqual([
      "resend",
      "test",
      "unconfigured",
    ]);

    for (const providerName of EMAIL_COMPLETION_PROVIDER_NAMES) {
      expect(
        normalizeEmailCompletionProviderName(providerName, "invalid provider"),
      ).toBe(providerName);
    }
  });

  it("normalizes an omitted provider without accepting arbitrary or retired values", () => {
    expect(
      normalizeEmailCompletionProviderName(undefined, "invalid provider"),
    ).toBe("unconfigured");
    for (const value of ["cloudflare-email-service", "legacy-provider", "resend\r\nforged", "unknown"]) {
      expect(() =>
        normalizeEmailCompletionProviderName(value, "invalid provider"),
      ).toThrow("invalid provider");
    }
  });
});
