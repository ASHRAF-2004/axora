import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const managerUrl = new URL("../tools/axora-manager.py", import.meta.url);
const managerPath = fileURLToPath(managerUrl);
const managerSource = readFileSync(managerUrl, "utf8");

describe("local manager identity diagnostics", () => {
  it("remains valid Python without launching GTK", () => {
    execFileSync("python3", [
      "-c",
      "from pathlib import Path; compile(Path(__import__('sys').argv[1]).read_text(), __import__('sys').argv[1], 'exec')",
      managerPath,
    ]);
  });

  it("keeps the embedded user surface read-only", () => {
    expect(managerSource).toContain("User and invitation diagnostics (read-only)");
    expect(managerSource).not.toMatch(
      /(?:INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(?:users|account_setup_invitations|account_credentials|role_assignments)/i,
    );
    expect(managerSource).not.toContain("_open_create_user_dialog");
    expect(managerSource).not.toContain("_reset_selected_password");
    expect(managerSource).not.toContain("_toggle_selected_user_active");
    expect(managerSource).not.toContain("_delete_selected_user");
  });

  it("never handles user password values or credential hashes", () => {
    expect(managerSource).not.toMatch(/temporary password/i);
    expect(managerSource).not.toContain("password_hash");
    expect(managerSource).not.toContain("bcryptjs");
    expect(managerSource).not.toMatch(/Generate (?:strong )?password/i);
  });

  it("shows normalized roles, scopes, profiles, and invitation delivery state", () => {
    for (const requiredFragment of [
      "role_assignments",
      "user_profiles",
      "account_setup_invitations",
      "account_kind",
      "account_status",
      "scope_type",
      "delivery_status",
      "profile_completed_at",
    ]) {
      expect(managerSource).toContain(requiredFragment);
    }
    expect(managerSource).toContain("to_regclass('public.role_assignments')");
    expect(managerSource).toContain('self._identity_model = "legacy"');
    expect(managerSource).toContain('self._identity_model = "normalized"');
  });
});
