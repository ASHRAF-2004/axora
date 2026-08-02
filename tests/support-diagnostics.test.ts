import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  diagnoseSupportAccount,
  getSupportSystemSummary,
  maskSupportEmail,
  revokeSupportTargetSessions,
  supportDiagnosticInternals,
} from "@/lib/support-diagnostics";
import type { SessionUser } from "@/lib/auth";

const supportActor: SessionUser = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  email: "support@axora.invalid",
  name: "Support actor",
  role: "TECHNICAL_SUPPORT",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  isOwner: false,
};

const ownerActor: SessionUser = {
  ...supportActor,
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  email: "owner@axora.invalid",
  role: "PLATFORM_OWNER",
  isOwner: true,
};

const companyActor: SessionUser = {
  ...supportActor,
  id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
  email: "company@axora.invalid",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: "10000000-0000-4000-8000-000000000001",
  isOwner: false,
};

describe("technical-support diagnostics", () => {
  it("requires an exact normalized email and an auditable reason", () => {
    expect(supportDiagnosticInternals.normalizeEmail(" Person@Example.COM "))
      .toBe("person@example.com");
    expect(() => supportDiagnosticInternals.normalizeEmail("not-an-email"))
      .toThrow("invalid_email");
    expect(supportDiagnosticInternals.supportReason(" Investigate repeated sign-in failures "))
      .toBe("Investigate repeated sign-in failures");
    expect(() => supportDiagnosticInternals.supportReason("too short"))
      .toThrow("invalid_reason");
  });

  it("masks account addresses in the support read model", () => {
    expect(maskSupportEmail("person@example.com")).toMatch(/^pe•+@example\.com$/);
    expect(maskSupportEmail("a@example.com")).toBe("a•••@example.com");
  });

  it("fails closed inside the service layer when a caller bypasses the route guard", async () => {
    await expect(getSupportSystemSummary(companyActor)).rejects.toThrow(
      "support_forbidden",
    );
    await expect(diagnoseSupportAccount(
      companyActor,
      "target@axora.invalid",
      "Investigate account access failure",
    )).rejects.toThrow("support_forbidden");
    await expect(revokeSupportTargetSessions(
      companyActor,
      "00000000-0000-4000-8000-000000000090",
      "Revoke sessions after verified report",
    )).rejects.toThrow("support_forbidden");
  });

  it("allows only the explicit support capability for canonical support and owners", async () => {
    await expect(getSupportSystemSummary(supportActor)).resolves.toMatchObject({
      latestMigration: "safe-review-fixture",
    });
    await expect(getSupportSystemSummary(ownerActor)).resolves.toMatchObject({
      latestMigration: "safe-review-fixture",
    });
  });

  it("keeps diagnostics and session control server-authorized and audited", async () => {
    const [actions, service, page, migration] = await Promise.all([
      readFile(new URL("../src/app/(portal)/support/actions.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/lib/support-diagnostics.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(portal)/support/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../database/migrations/031_support_diagnostics_security.sql", import.meta.url), "utf8"),
    ]);
    expect(actions).toContain('requirePermission("view_system_diagnostics")');
    expect(page).toContain('requirePagePermission("view_system_diagnostics")');
    expect(migration).toContain("support_account_diagnostic");
    expect(migration).toContain("support_session_control");
    expect(service).toContain("account_kind='PLATFORM'");
    expect(service).toContain("auth_version=auth_version+1");
    expect(service).toContain("axora_record_support_audit");
    expect(service).toContain("requireSupportDiagnosticPermission(actor)");
    expect(service).not.toContain("INSERT INTO audit_logs");
    expect(service).not.toMatch(/password_hash|token_hash\s+AS/i);
  });
});
