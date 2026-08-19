import { describe, expect, it } from "vitest";
import { emailProviderRuntimeReadiness } from "@/lib/email-operations";

describe("email operations runtime readiness", () => {
  it("reports the Resend launch gates without provider-credit semantics", () => {
    expect(emailProviderRuntimeReadiness({
      NODE_ENV: "test",
      AXORA_EMAIL_PROVIDER: "resend",
      AXORA_EMAIL_DELIVERY_ENABLED: "false",
      AXORA_EMAIL_EVENTS_ENABLED: "true",
      RESEND_DOMAIN_VERIFIED: "true",
      RESEND_WEBHOOK_VERIFIED: "true",
    })).toEqual({
      providerName: "resend",
      state: "READY_FOR_CONTROLLED_SEND",
      deliveryEnabled: false,
      eventsEnabled: true,
      domainVerified: true,
      webhookVerified: true,
    });
  });

  it("fails closed for a retired provider selection", () => {
    expect(emailProviderRuntimeReadiness({
      AXORA_EMAIL_PROVIDER: "legacy-provider",
      AXORA_EMAIL_DELIVERY_ENABLED: "false",
      AXORA_EMAIL_EVENTS_ENABLED: "false",
      RESEND_DOMAIN_VERIFIED: "true",
      RESEND_WEBHOOK_VERIFIED: "true",
    }).state).toBe("MISCONFIGURED");
  });
});
