import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  EMAIL_TEMPLATE_CATALOGUE,
  emailTemplateCatalogueInternals,
} from "../server-tools/email-template-catalogue.mjs";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

const retiredProviderName = ["zepto", "mail"].join("");
const retiredOutboundPattern = new RegExp(
  `${retiredProviderName}|cloudflare-email-service|cloudflare_email_api_token|CLOUDFLARE_EMAIL_API_TOKEN_FILE`,
  "i",
);

describe("active outbound email provider contract", () => {
  it("routes every registered transactional template through provider-neutral Axora streams", () => {
    const allowedStreams = new Set(emailTemplateCatalogueInternals.AGENTS);
    expect(Object.keys(EMAIL_TEMPLATE_CATALOGUE).length).toBeGreaterThan(30);
    for (const [key, definition] of Object.entries(EMAIL_TEMPLATE_CATALOGUE)) {
      expect(definition.key).toBe(key);
      expect(allowedStreams.has(definition.agent)).toBe(true);
      expect(definition.supportedLocales).toEqual(["en", "ar", "ms"]);
      expect(definition.tracking).toEqual({ opens: false, clicks: false });
    }
    expect(JSON.stringify(EMAIL_TEMPLATE_CATALOGUE)).not.toMatch(retiredOutboundPattern);
  });

  it("keeps the central sender as the only active outbound provider boundary", async () => {
    const sender = await source("server-tools/email-sender.mjs");
    expect(sender).toContain('const RESEND_ENDPOINT = "https://api.resend.com/emails"');
    expect(sender).toContain("createResendEmailProvider");
    expect(sender).toContain('if (name === "resend")');
    expect(sender).toContain('providerName: "resend"');
    expect(sender).not.toMatch(retiredOutboundPattern);
  });

  it("keeps current runtime, compose and production scripts Resend-only for outbound mail", async () => {
    const paths = [
      "compose.yaml",
      ".env.example",
      ".env.production.example",
      "deploy/systemd/runtime.env.example",
      "scripts/production/check-email-service.mjs",
      "scripts/production/preflight.sh",
      "scripts/production/install.sh",
      "scripts/production/validate-assets.sh",
    ];
    const values = await Promise.all(paths.map(source));
    for (const value of values) expect(value).not.toMatch(retiredOutboundPattern);

    const [compose, localEnv, productionEnv, runtimeEnv, checker] = values;
    expect(compose).toContain('AXORA_EMAIL_PROVIDER: "${AXORA_EMAIL_PROVIDER:-resend}"');
    expect(localEnv).toContain("AXORA_EMAIL_PROVIDER=resend");
    expect(productionEnv).toContain("AXORA_EMAIL_PROVIDER=resend");
    expect(runtimeEnv).toContain("AXORA_EMAIL_PROVIDER=resend");
    expect(checker).toContain("verifyResendConfiguration");
  });

  it("publishes only the Resend outbound lifecycle endpoint", async () => {
    const [matrixSource, caddy] = await Promise.all([
      source("scripts/production/authenticated-route-matrix.json"),
      source("caddy/Caddyfile.production"),
    ]);
    const matrix = JSON.parse(matrixSource);
    const providerRoutes = matrix.apiRoutes
      .map((entry) => entry.route)
      .filter((route) => route.startsWith("/api/email/provider-events/"));
    expect(providerRoutes).toEqual(["/api/email/provider-events/resend"]);
    expect(caddy).toContain("/api/email/provider-events/resend");
    expect(caddy).not.toContain("/api/email/provider-events/cloudflare");
    expect(caddy.toLowerCase()).not.toContain(`provider-events/${retiredProviderName}`);
  });

  it("preserves Cloudflare inbound Email Routing and Cloudflare networking as a separate direction", async () => {
    const [architecture, productionCompose] = await Promise.all([
      source("docs/EMAIL_ARCHITECTURE.md"),
      source("compose.production.yaml"),
    ]);
    expect(architecture).toContain("Cloudflare Email Routing / inbound receiving");
    expect(architecture).toContain("Cloudflare — preserved");
    expect(architecture).toContain("cloudflared");
    expect(architecture).toContain("Resend is the only active production provider");
    expect(productionCompose).toContain("cloudflare/cloudflared:");
    expect(productionCompose).toContain("cloudflare_tunnel_token");
  });
});
