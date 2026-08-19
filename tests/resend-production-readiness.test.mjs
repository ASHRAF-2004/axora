import { describe, expect, it } from "vitest";
import {
  inspectResendRuntimeState,
  verifyResendConfiguration,
} from "../scripts/production/check-email-service.mjs";
import { emailProviderRuntimeReadiness } from "../src/lib/email-operations.ts";

function runtime(overrides = {}) {
  return Object.entries({
    AXORA_EMAIL_PROVIDER: "resend",
    AXORA_EMAIL_DELIVERY_ENABLED: "false",
    AXORA_EMAIL_EVENTS_ENABLED: "false",
    RESEND_DOMAIN_VERIFIED: "true",
    RESEND_WEBHOOK_VERIFIED: "false",
    AXORA_EMAIL_FROM_ADDRESS: "noreply@axora.management",
    ...overrides,
  }).map(([key, value]) => `${key}=${value}`).join("\n");
}

describe("Resend production readiness", () => {
  it("represents the safe deployed state with only Resend gates", () => {
    expect(inspectResendRuntimeState({ runtimeSource: runtime() })).toMatchObject({
      provider: "resend",
      state: "DELIVERY_DISABLED",
      deliveryEnabled: false,
      eventsEnabled: false,
      blockers: ["RESEND_WEBHOOK_VERIFIED"],
    });
    expect(emailProviderRuntimeReadiness({
      AXORA_EMAIL_PROVIDER: "resend",
      AXORA_EMAIL_DELIVERY_ENABLED: "false",
      AXORA_EMAIL_EVENTS_ENABLED: "false",
      RESEND_DOMAIN_VERIFIED: "true",
      RESEND_WEBHOOK_VERIFIED: "false",
    })).toEqual({
      providerName: "resend",
      state: "DELIVERY_DISABLED",
      deliveryEnabled: false,
      eventsEnabled: false,
      domainVerified: true,
      webhookVerified: false,
    });
  });

  it("rejects retired provider selection", () => {
    for (const provider of ["cloudflare-email-service", "legacy-provider"]) {
      expect(() => inspectResendRuntimeState({
        runtimeSource: runtime({ AXORA_EMAIL_PROVIDER: provider }),
      })).toThrow("AXORA_EMAIL_PROVIDER=resend");
    }
  });

  it("allows signed events before delivery but blocks false verification claims", () => {
    expect(inspectResendRuntimeState({
      runtimeSource: runtime({ AXORA_EMAIL_EVENTS_ENABLED: "true" }),
    }).state).toBe("SIGNED_WEBHOOK_CONFIGURED");
    expect(() => inspectResendRuntimeState({
      runtimeSource: runtime({ RESEND_WEBHOOK_VERIFIED: "true" }),
    })).toThrow("requires signed provider events");
  });

  it("blocks delivery until domain and webhook evidence are true", () => {
    expect(() => inspectResendRuntimeState({
      runtimeSource: runtime({
        AXORA_EMAIL_DELIVERY_ENABLED: "true",
        AXORA_EMAIL_EVENTS_ENABLED: "true",
      }),
    })).toThrow("RESEND_WEBHOOK_VERIFIED");
    expect(() => inspectResendRuntimeState({
      runtimeSource: runtime({
        AXORA_EMAIL_DELIVERY_ENABLED: "true",
        AXORA_EMAIL_EVENTS_ENABLED: "true",
        RESEND_DOMAIN_VERIFIED: "false",
        RESEND_WEBHOOK_VERIFIED: "true",
      }),
    })).toThrow("RESEND_DOMAIN_VERIFIED");
  });

  it("validates a protected-key shape only in the fully enabled launch gate", () => {
    const source = runtime({
      AXORA_EMAIL_DELIVERY_ENABLED: "true",
      AXORA_EMAIL_EVENTS_ENABLED: "true",
      RESEND_WEBHOOK_VERIFIED: "true",
    });
    expect(verifyResendConfiguration({
      runtimeSource: source,
      tokenSource: "re_synthetic_production_key_value",
    })).toMatchObject({ provider: "resend", senderDomain: "axora.management" });
    expect(() => verifyResendConfiguration({
      runtimeSource: source,
      tokenSource: "unsafe key with spaces",
    })).toThrow("malformed");
  });
});
