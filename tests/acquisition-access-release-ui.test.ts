import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveUserCreation } from "@/lib/users";
import type { SessionUser } from "@/lib/auth";

const companyAdmin: SessionUser = {
  id: "56000000-0000-4000-8000-000000000001",
  email: "admin-056@example.test",
  name: "Company admin",
  role: "COMPANY_ADMIN",
  accountKind: "COMPANY",
  scopeType: "COMPANY",
  companyId: "56000000-0000-4000-8000-000000000002",
  roleAssignmentId: "56000000-0000-4000-8000-000000000003",
  isOwner: false,
};

describe("acquisition and account access release UI", () => {
  it("resolves department-scoped invitations without trusting a cross-tenant identifier", () => {
    const resolved = resolveUserCreation({
      email: "requester@example.test",
      displayName: "Department requester",
      role: "REQUESTER",
      companyId: "56000000-0000-4000-8000-000000000099",
      branchId: "56000000-0000-4000-8000-000000000004",
      departmentId: "56000000-0000-4000-8000-000000000005",
      preferredLocale: "ar",
    }, companyAdmin);
    expect(resolved).toMatchObject({
      companyId: companyAdmin.companyId,
      scopeType: "DEPARTMENT",
      branchId: "56000000-0000-4000-8000-000000000004",
      departmentId: "56000000-0000-4000-8000-000000000005",
      preferredLocale: "ar",
    });
  });

  it("ships English, Arabic and Malay onboarding and hierarchy workspaces with logical responsive layout", () => {
    const onboardingCopy = readFileSync(
      new URL("../src/lib/company-onboarding-i18n.ts", import.meta.url),
      "utf8",
    );
    const organizationCopy = readFileSync(
      new URL("../src/lib/organization-structure-i18n.ts", import.meta.url),
      "utf8",
    );
    const onboardingPage = readFileSync(
      new URL("../src/app/(portal)/companies/[companyId]/onboarding/page.tsx", import.meta.url),
      "utf8",
    );
    const organizationPage = readFileSync(
      new URL("../src/app/(portal)/branches/organization/page.tsx", import.meta.url),
      "utf8",
    );
    for (const source of [onboardingCopy, organizationCopy]) {
      expect(source).toContain("const en");
      expect(source).toContain("const ar");
      expect(source).toContain("const ms");
      expect(source).toMatch(/[\u0600-\u06ff]/);
    }
    expect(onboardingPage).toContain("repeat(auto-fit,minmax(min(100%,360px),1fr))");
    expect(organizationPage).toContain("marginInlineStart");
    expect(`${onboardingPage}\n${organizationPage}`).not.toMatch(/marginLeft|marginRight/);
  });

  it("carries immutable department scope through invitation creation and activation", () => {
    const accountSetup = readFileSync(
      new URL("../src/lib/account-setup.ts", import.meta.url),
      "utf8",
    );
    const isolation = readFileSync(
      new URL("../src/lib/account-invitation-isolation.ts", import.meta.url),
      "utf8",
    );
    expect(accountSetup).toContain("intended_department_id");
    expect(accountSetup).toContain("department_assignments");
    expect(accountSetup).toContain("departmentId: invitation.departmentId");
    expect(accountSetup).toContain("resolved.role === \"COMPANY_ADMIN\"");
    expect(accountSetup).toContain("'COMPANY_REVIEW','COMPANY_ADMINISTRATOR_INVITED'");
    expect(isolation).toContain("resolved.departmentId ?? null");
    expect(isolation).toContain("snapshot.scope.departmentId === resolved.departmentId");
  });
});
