import { describe, expect, it, vi } from "vitest";
import {
  runtimeValue,
  verifyEmailServiceConfiguration,
} from "../scripts/production/check-email-service.mjs";

const accountId = "0123456789abcdef0123456789abcdef";
const zoneId = "fedcba9876543210fedcba9876543210";
const runtimeSource = [
  `CLOUDFLARE_ACCOUNT_ID=${accountId}`,
  `CLOUDFLARE_ZONE_ID=${zoneId}`,
  "AXORA_EMAIL_FROM_ADDRESS=noreply@axora.management",
  "",
].join("\n");
const tokenSource = "cfat_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG\n";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("production Cloudflare Email Sending preflight", () => {
  it("verifies the configured account token before the zone and sending domain", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        result: { id: "a".repeat(32), status: "active" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        result: [{
          name: "axora.management",
          enabled: true,
          preview_enabled: false,
        }],
      }));

    await expect(verifyEmailServiceConfiguration({
      runtimeSource,
      tokenSource,
      fetchImpl,
    })).resolves.toEqual({ accountId, zoneId, senderDomain: "axora.management" });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,
    );
    expect(fetchImpl.mock.calls[1][0]).toBe(
      `https://api.cloudflare.com/client/v4/zones/${zoneId}/email/sending/subdomains`,
    );
    for (const [, options] of fetchImpl.mock.calls) {
      expect(options.headers.Authorization).toBe(`Bearer ${tokenSource.trim()}`);
    }
  });

  it("rejects inactive account tokens without probing the sending zone", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      result: { id: "a".repeat(32), status: "expired" },
    }));

    await expect(verifyEmailServiceConfiguration({
      runtimeSource,
      tokenSource,
      fetchImpl,
    })).rejects.toThrow(/not active/);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("rejects a zone response that does not enable the exact sender domain", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        result: { id: "a".repeat(32), status: "active" },
      }))
      .mockResolvedValueOnce(jsonResponse({
        success: true,
        result: [
          { name: "mail.axora.management", enabled: true },
          { name: "axora.management", enabled: false },
        ],
      }));

    await expect(verifyEmailServiceConfiguration({
      runtimeSource,
      tokenSource,
      fetchImpl,
    })).rejects.toThrow(/not enabled for axora\.management/);
  });

  it.each([true, undefined])(
    "rejects an enabled domain unless provider-side message preview is explicitly off (%s)",
    async (previewEnabled) => {
      const fetchImpl = vi.fn()
        .mockResolvedValueOnce(jsonResponse({
          success: true,
          result: { id: "a".repeat(32), status: "active" },
        }))
        .mockResolvedValueOnce(jsonResponse({
          success: true,
          result: [{
            name: "axora.management",
            enabled: true,
            ...(previewEnabled === undefined ? {} : { preview_enabled: previewEnabled }),
          }],
        }));

      await expect(verifyEmailServiceConfiguration({
        runtimeSource,
        tokenSource,
        fetchImpl,
      })).rejects.toThrow(/Email preview must be disabled/);
    },
  );

  it("requires exactly one non-empty value for every runtime key it reads", () => {
    expect(() => runtimeValue(
      "CLOUDFLARE_ZONE_ID=first\nCLOUDFLARE_ZONE_ID=second\n",
      "CLOUDFLARE_ZONE_ID",
    )).toThrow(/exactly one/);
    expect(() => runtimeValue("CLOUDFLARE_ZONE_ID=\n", "CLOUDFLARE_ZONE_ID"))
      .toThrow(/exactly one/);
    expect(() => runtimeValue(runtimeSource, "unsafe-key"))
      .toThrow(/Invalid production runtime configuration key/);
  });
});
