import { describe, expect, it } from "vitest";
import {
  EMAIL_COMPLETION_PROVIDER_NAMES,
  normalizeEmailCompletionProviderName,
} from "@/lib/email-completion-provider";

describe("email completion provider validation", () => {
  it("accepts every provider supported by the shared completion path", () => {
    expect(EMAIL_COMPLETION_PROVIDER_NAMES).toEqual([
      "resend",
      "zeptomail",
      "cloudflare-email-service",
      "test",
      "unconfigured",
    ]);

    for (const providerName of EMAIL_COMPLETION_PROVIDER_NAMES) {
      expect(
        normalizeEmailCompletionProviderName(providerName, "invalid provider"),
      ).toBe(providerName);
    }
  });

  it("normalizes an omitted provider without accepting arbitrary values", () => {
    expect(
      normalizeEmailCompletionProviderName(undefined, "invalid provider"),
    ).toBe("unconfigured");
    expect(() =>
      normalizeEmailCompletionProviderName("resend\r\nforged", "invalid provider"),
    ).toThrow("invalid provider");
    expect(() =>
      normalizeEmailCompletionProviderName("unknown", "invalid provider"),
    ).toThrow("invalid provider");
  });
});
