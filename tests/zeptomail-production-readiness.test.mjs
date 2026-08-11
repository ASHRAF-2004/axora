import { describe, expect, it } from "vitest";
import {
  inspectZeptoMailRuntimeState,
  isZeptoMailProviderAgentKey,
  verifyZeptoMailConfiguration,
} from "../scripts/production/check-email-service.mjs";

const providerAgentKey = "2d6f.2f584a3cd668e3a6.synthetic_agent-key";

function runtime(overrides = {}) {
  const values = {
    AXORA_EMAIL_PROVIDER: "zeptomail",
    AXORA_EMAIL_FROM_ADDRESS: "noreply@axora.management",
    AXORA_EMAIL_DELIVERY_ENABLED: "false",
    AXORA_EMAIL_EVENTS_ENABLED: "false",
    ZEPTOMAIL_WEBHOOK_BOOTSTRAP_ENABLED: "false",
    ZEPTOMAIL_MAIL_AGENT_KEY: providerAgentKey,
    ZEPTOMAIL_ACCOUNT_REVIEWED: "false",
    ZEPTOMAIL_DOMAIN_VERIFIED: "true",
    ZEPTOMAIL_CREDITS_READY: "true",
    ZEPTOMAIL_WEBHOOK_VERIFIED: "false",
    ...overrides,
  };
  return Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n");
}

describe("ZeptoMail production readiness states", () => {
  it("permits side-effect-free webhook bootstrap while delivery and events remain disabled", () => {
    const result = inspectZeptoMailRuntimeState({
      runtimeSource: runtime({ ZEPTOMAIL_WEBHOOK_BOOTSTRAP_ENABLED: "true" }),
    });
    expect(result).toMatchObject({
      state: "WEBHOOK_BOOTSTRAP",
      deliveryEnabled: false,
      eventsEnabled: false,
      providerAgentConfigured: true,
    });
  });

  it("rejects bootstrap with delivery and blocks sending on incomplete review or webhook evidence", () => {
    expect(() => inspectZeptoMailRuntimeState({
      runtimeSource: runtime({
        AXORA_EMAIL_DELIVERY_ENABLED: "true",
        AXORA_EMAIL_EVENTS_ENABLED: "true",
        ZEPTOMAIL_WEBHOOK_BOOTSTRAP_ENABLED: "true",
      }),
    })).toThrow("requires email delivery and provider events to remain disabled");
    expect(() => inspectZeptoMailRuntimeState({
      runtimeSource: runtime({
        AXORA_EMAIL_DELIVERY_ENABLED: "true",
        AXORA_EMAIL_EVENTS_ENABLED: "true",
      }),
    })).toThrow("ZEPTOMAIL_ACCOUNT_REVIEWED, ZEPTOMAIL_WEBHOOK_VERIFIED");
  });

  it("allows signed webhook verification before delivery and requires one provider Agent", () => {
    expect(inspectZeptoMailRuntimeState({
      runtimeSource: runtime({ AXORA_EMAIL_EVENTS_ENABLED: "true" }),
    }).state).toBe("SIGNED_WEBHOOK_CONFIGURED");
    expect(() => inspectZeptoMailRuntimeState({
      runtimeSource: runtime({
        AXORA_EMAIL_EVENTS_ENABLED: "true",
        ZEPTOMAIL_MAIL_AGENT_KEY: "",
      }),
    })).toThrow("must be the opaque ZeptoMail webhook mailagent_key");
  });

  it.each([
    "segment..segment",
    ".segment",
    "segment.",
    "segment/segment",
    "segment segment",
    "segment\nsegment",
    "segment;segment",
    "segment:segment",
    "segment$segment",
    "x".repeat(201),
  ])("rejects malformed provider Agent configuration", (value) => {
    expect(isZeptoMailProviderAgentKey(value)).toBe(false);
    expect(() => inspectZeptoMailRuntimeState({
      runtimeSource: runtime({
        ZEPTOMAIL_WEBHOOK_BOOTSTRAP_ENABLED: "true",
        ZEPTOMAIL_MAIL_AGENT_KEY: value,
      }),
    })).toThrow();
  });

  it("accepts the bounded current period-separated provider format", () => {
    expect(isZeptoMailProviderAgentKey(providerAgentKey)).toBe(true);
    expect(inspectZeptoMailRuntimeState({
      runtimeSource: runtime({ ZEPTOMAIL_WEBHOOK_BOOTSTRAP_ENABLED: "true" }),
    }).providerAgentConfigured).toBe(true);
  });

  it("accepts fully evidenced delivery with one Agent rather than six logical-stream keys", () => {
    const runtimeSource = runtime({
      AXORA_EMAIL_DELIVERY_ENABLED: "true",
      AXORA_EMAIL_EVENTS_ENABLED: "true",
      ZEPTOMAIL_ACCOUNT_REVIEWED: "true",
      ZEPTOMAIL_WEBHOOK_VERIFIED: "true",
    });
    expect(verifyZeptoMailConfiguration({
      runtimeSource,
      tokenSource: "token-value-that-is-long-enough",
    })).toMatchObject({ provider: "zeptomail", agentCount: 1 });
  });
});
