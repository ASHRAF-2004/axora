import { describe, expect, it } from "vitest";
import type { SessionUser } from "@/lib/auth";
import {
  emailOperationsInternals,
  maskEmailAddress,
  normalizeEmailOperationsFilters,
} from "@/lib/email-operations";

function actor(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    email: "fixture@axora.invalid",
    name: "Email fixture",
    role: "PLATFORM_OWNER",
    accountKind: "PLATFORM",
    scopeType: "PLATFORM",
    accountStatus: "ACTIVE",
    isOwner: true,
    authVersion: 1,
    ...overrides,
  } as SessionUser;
}

describe("email operations application boundary", () => {
  it("normalizes every supported filter and drops malformed values", () => {
    expect(normalizeEmailOperationsFilters({
      from: "2026-08-01", to: "2026-08-09",
      agent: "axora-auth", event: "approval.company_required",
      template: "company-approval-required", status: "pending",
      companyId: "10000000-0000-4000-8000-000000000001",
      domain: "example.invalid", error: "provider_rate_limited",
      correlation: "20000000-0000-4000-8000-000000000001",
      entity: "request", offset: "99999",
    })).toEqual({
      from: "2026-08-01", to: "2026-08-09",
      agent: "axora-auth", event: "approval.company_required",
      template: "company-approval-required", status: "PENDING",
      companyId: "10000000-0000-4000-8000-000000000001",
      domain: "example.invalid", error: "provider_rate_limited",
      correlation: "20000000-0000-4000-8000-000000000001",
      entity: "request", offset: "10000",
    });
    expect(normalizeEmailOperationsFilters({
      from: "2026-99-99", agent: "root", status: "SECRET",
      companyId: "not-a-uuid", domain: "bad domain", error: "DROP TABLE",
      entity: "x\nsecret", offset: "-1",
    })).toEqual({});
  });

  it("masks addresses without retaining the local part", () => {
    expect(maskEmailAddress("Approval.Owner@Example.COM"))
      .toBe("ap***@example.com");
    expect(maskEmailAddress("x@example.com")).toBe("x***@example.com");
    expect(maskEmailAddress("not-an-address"))
      .toBe("private operations recipient");
  });

  it("allows owners and platform operations to manage, CAMs to view, and company users neither", () => {
    expect(() => emailOperationsInternals.requireManage(actor())).not.toThrow();
    expect(() => emailOperationsInternals.requireManage(actor({
      role: "PLATFORM_OPERATIONS", isOwner: false,
    }))).not.toThrow();
    const manager = actor({
      role: "CLIENT_ACCOUNT_MANAGER", isOwner: false,
      scopeType: "COMPANY", companyId: "30000000-0000-4000-8000-000000000001",
    });
    expect(() => emailOperationsInternals.requireView(manager)).not.toThrow();
    expect(() => emailOperationsInternals.requireManage(manager)).toThrow();
    const company = actor({
      role: "COMPANY_ADMIN", isOwner: false, accountKind: "COMPANY",
      scopeType: "COMPANY", companyId: "30000000-0000-4000-8000-000000000001",
    });
    expect(() => emailOperationsInternals.requireView(company)).toThrow();
  });

  it("uses only narrow database capabilities and privacy-minimized webhook evidence", () => {
    expect(emailOperationsInternals.sql.workspace)
      .toContain("axora_email_operations_snapshot");
    expect(emailOperationsInternals.sql.command)
      .toContain("axora_email_operations_command");
    expect(emailOperationsInternals.sql.webhookFailure)
      .toContain("axora_record_email_webhook_failure");
    const sql = JSON.stringify(emailOperationsInternals.sql).toLowerCase();
    expect(sql).not.toContain("recipient_email");
    expect(sql).not.toContain("provider_message_id");
  });
});
