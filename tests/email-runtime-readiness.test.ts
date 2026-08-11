import { describe, expect, it } from "vitest";
import { emailProviderRuntimeReadiness } from "@/lib/email-operations";

describe("email operations runtime readiness", () => {
  it("separates ZeptoMail bootstrap evidence from manual allowance health", () => {
    expect(emailProviderRuntimeReadiness({
      NODE_ENV: "test",
      AXORA_EMAIL_PROVIDER: "zeptomail",
      AXORA_EMAIL_DELIVERY_ENABLED: "false",
      AXORA_EMAIL_EVENTS_ENABLED: "false",
      ZEPTOMAIL_WEBHOOK_BOOTSTRAP_ENABLED: "true",
      ZEPTOMAIL_ACCOUNT_REVIEWED: "false",
      ZEPTOMAIL_DOMAIN_VERIFIED: "true",
      ZEPTOMAIL_CREDITS_READY: "true",
      ZEPTOMAIL_WEBHOOK_VERIFIED: "false",
    })).toEqual({
      providerName: "zeptomail",
      state: "WEBHOOK_BOOTSTRAP",
      deliveryEnabled: false,
      eventsEnabled: false,
      bootstrapEnabled: true,
      accountReviewed: false,
      domainVerified: true,
      creditsReady: true,
      webhookVerified: false,
    });
  });
});
