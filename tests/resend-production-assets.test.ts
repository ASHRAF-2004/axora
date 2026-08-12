import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("Resend production assets", () => {
  it("initializes protected files only after the secret directory and preserves existing bytes", async () => {
    const installer = await read("scripts/production/install.sh");
    const directoryIndex = installer.indexOf('install -d -o root -g "$RUNTIME_GID" -m 0710 "$SECRETS_DIR"');
    const blockIndex = installer.indexOf("for resend_secret_name in resend_api_key resend_webhook_secret");
    expect(directoryIndex).toBeGreaterThan(0);
    expect(blockIndex).toBeGreaterThan(directoryIndex);
    const block = installer.slice(blockIndex, installer.indexOf("done", blockIndex) + 4);
    expect(block).toContain('if [[ ! -e "$resend_secret_file" ]]');
    expect(block).toContain('install -o root -g "$RUNTIME_GID" -m 0640 /dev/null');
    expect(block).toContain('chown root:"$RUNTIME_GID" "$resend_secret_file"');
    expect(block).toContain('chmod 0640 "$resend_secret_file"');
    expect(block.match(/\/dev\/null/g)).toHaveLength(1);
  });

  it("mounts each Resend secret only into the service that needs it", async () => {
    const compose = await read("compose.yaml");
    expect(compose).toContain("RESEND_API_KEY_FILE: /run/secrets/resend_api_key");
    expect(compose).toContain("RESEND_WEBHOOK_SECRET_FILE: /run/secrets/resend_webhook_secret");
    const app = compose.slice(compose.indexOf("  app:"), compose.indexOf("  email-sender:"));
    const sender = compose.slice(compose.indexOf("  email-sender:"), compose.indexOf("  budget-worker:"));
    expect(app).not.toContain("RESEND_API_KEY_FILE");
    expect(sender).not.toContain("RESEND_WEBHOOK_SECRET_FILE");
  });

  it("keeps the production callback bounded and registered in the route matrix", async () => {
    const [caddy, matrix] = await Promise.all([
      read("caddy/Caddyfile.production"),
      read("scripts/production/authenticated-route-matrix.json"),
    ]);
    expect(caddy).toMatch(/@resend_email_event_webhook[\s\S]*max_size 16KB/);
    expect(JSON.parse(matrix).apiRoutes).toContainEqual(expect.objectContaining({
      route: "/api/email/provider-events/resend",
      authentication: "signed-provider-event",
    }));
  });
});
