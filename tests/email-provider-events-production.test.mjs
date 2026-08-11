import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

describe("production Email Sending event wiring", () => {
  it("mounts the dedicated app-only webhook secret outside tracked environment values", async () => {
    const [compose, production, runtime] = await Promise.all([
      source("compose.yaml"),
      source("compose.production.yaml"),
      source("deploy/systemd/runtime.env.example"),
    ]);
    expect(compose).toContain(
      "AXORA_EMAIL_EVENTS_WEBHOOK_SECRET_FILE: /run/secrets/axora_email_events_webhook_secret",
    );
    expect(compose).toContain("- axora_email_events_webhook_secret");
    expect(production).toContain(
      "/axora_email_events_webhook_secret\"",
    );
    expect(runtime).toContain("AXORA_EMAIL_EVENTS_ENABLED=false");
    expect(runtime).toContain("ZEPTOMAIL_WEBHOOK_BOOTSTRAP_ENABLED=false");
    expect(runtime).toContain("ZEPTOMAIL_MAIL_AGENT_KEY=");
    expect(runtime).not.toContain("AXORA_EMAIL_EVENTS_WEBHOOK_SECRET=");
  });

  it("installs a hardened empty placeholder and refuses unsafe enabled delivery", async () => {
    const [installer, preflight] = await Promise.all([
      source("scripts/production/install.sh"),
      source("scripts/production/preflight.sh"),
    ]);
    expect(installer).toContain(
      'email_events_webhook_secret_file="$SECRETS_DIR/axora_email_events_webhook_secret"',
    );
    expect(installer).toContain("AXORA_EMAIL_EVENTS_ENABLED false");
    expect(preflight).toContain(
      "Email delivery requires the Email Sending event consumer and suppression endpoint.",
    );
    expect(preflight).toContain(
      'email_events_key_path="$AXORA_SECRETS_DIR/axora_email_events_webhook_secret"',
    );
    expect(preflight).toContain("0:1000");
  });

  it("bounds the public event endpoint below the normal application body limit", async () => {
    const caddy = await source("caddy/Caddyfile.production");
    expect(caddy).toContain(
      "@cloudflare_email_event_webhook path /api/email/provider-events/cloudflare",
    );
    expect(caddy).toMatch(/request_body @cloudflare_email_event_webhook \{\s+max_size 4KB/);
    expect(caddy).toMatch(/request_body @zeptomail_email_event_webhook \{\s+max_size 16KB/);
  });
});
