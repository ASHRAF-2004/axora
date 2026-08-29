import { readFile } from "node:fs/promises";
import { describe,expect,it } from "vitest";

describe("Slack private application manifest",()=>{
  it("declares only the reviewed callbacks, scopes, and revocation events",async()=>{
    const manifest=await readFile("integrations/slack/manifest.yaml","utf8");
    expect(manifest).toContain(
      "https://axora.management/api/integrations/slack/oauth/callback",
    );
    expect(manifest).toContain(
      "https://axora.management/api/integrations/slack/events",
    );
    const scopeBlock=manifest.match(/scopes:\n\s+bot:\n((?:\s+- [^\n]+\n)+)/)?.[1]
      ?.trim().split(/\n/).map((line)=>line.replace(/^\s*-\s*/,"")).sort();
    expect(scopeBlock).toEqual(["channels:read","chat:write"]);
    expect(manifest).toContain("- app_uninstalled");
    expect(manifest).toContain("- tokens_revoked");
    expect(manifest).toContain("token_rotation_enabled: true");
    expect(manifest).toContain("socket_mode_enabled: false");
    for(const forbidden of [
      "chat:write.public","groups:read","admin.","users:write","files:write",
      "commands:","interactivity:",
    ])expect(manifest).not.toContain(forbidden);
  });
});
