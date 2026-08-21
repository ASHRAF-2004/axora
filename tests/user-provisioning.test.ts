import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  USER_PROVISIONING_ROLE_CONFIGS,
  userProvisioningRoleConfig,
  validateProvisioningOrganizationShape,
} from "@/lib/user-provisioning";

const expectedRoles = [
  "PLATFORM_OWNER",
  "HUMAN_RESOURCES_MANAGEMENT",
  "CLIENT_ACCOUNT_MANAGER",
  "COMPANY_ADMIN",
  "BRANCH_ADMIN",
  "DEPARTMENT_ADMIN",
  "COMPANY_APPROVER",
  "BRANCH_APPROVER",
  "REQUESTER",
  "DELIVERY_GUY",
] as const;

describe("Create User provisioning configuration", () => {
  it("contains only the current creatable role catalogue surface", () => {
    expect(USER_PROVISIONING_ROLE_CONFIGS.map((item) => item.role)).toEqual(expectedRoles);
    for (const unavailable of [
      "PLATFORM_OPERATIONS",
      "TECHNICAL_SUPPORT",
      "FINANCE_REVIEWER",
      "AUDITOR",
      "RECEIVING_USER",
      "DELIVERY_TEAM_SUPERVISOR",
      "DELIVERY_AGENT",
      "DELIVERY_DRIVER",
    ]) {
      expect(USER_PROVISIONING_ROLE_CONFIGS.some((item) => item.role === unavailable)).toBe(false);
    }
  });

  it.each([
    ["HUMAN_RESOURCES_MANAGEMENT", "PLATFORM", false, false, false],
    ["CLIENT_ACCOUNT_MANAGER", "PLATFORM", false, false, false],
    ["COMPANY_ADMIN", "COMPANY", true, false, false],
    ["BRANCH_ADMIN", "BRANCH", true, true, false],
    ["DEPARTMENT_ADMIN", "DEPARTMENT", true, true, true],
    ["COMPANY_APPROVER", "COMPANY", true, false, false],
    ["BRANCH_APPROVER", "BRANCH", true, true, false],
    ["DELIVERY_GUY", "DELIVERY", false, false, false],
  ] as const)("maps %s to the exact progressive organization fields", (
    role, scope, company, branch, department,
  ) => {
    expect(userProvisioningRoleConfig(role)).toMatchObject({
      creationScopes: [scope],
      showCompany: company,
      showBranch: branch,
      showDepartment: department,
    });
  });

  it("keeps Requester limited to branch or department scope", () => {
    expect(userProvisioningRoleConfig("REQUESTER")).toMatchObject({
      creationScopes: ["BRANCH", "DEPARTMENT"],
      showCompany: true,
      showBranch: true,
      showDepartment: true,
    });
  });
});

describe("Create User payload shape validation", () => {
  it("accepts platform and delivery identities without tenant fields", () => {
    for (const role of [
      "HUMAN_RESOURCES_MANAGEMENT",
      "CLIENT_ACCOUNT_MANAGER",
      "DELIVERY_GUY",
    ] as const) {
      expect(() => validateProvisioningOrganizationShape({ role })).not.toThrow();
    }
  });

  it("rejects stale organization identifiers for platform and delivery roles", () => {
    for (const role of [
      "HUMAN_RESOURCES_MANAGEMENT",
      "CLIENT_ACCOUNT_MANAGER",
      "DELIVERY_GUY",
    ] as const) {
      expect(() => validateProvisioningOrganizationShape({
        role,
        companyId: "10000000-0000-4000-8000-000000000001",
      })).toThrow(/does not accept a customer company scope/);
    }
  });

  it("requires the exact progressive company hierarchy", () => {
    expect(() => validateProvisioningOrganizationShape({ role: "COMPANY_ADMIN" }))
      .toThrow(/Select the approved customer company/);
    expect(() => validateProvisioningOrganizationShape({
      role: "BRANCH_ADMIN",
      companyId: "10000000-0000-4000-8000-000000000001",
    })).toThrow(/Select the branch/);
    expect(() => validateProvisioningOrganizationShape({
      role: "DEPARTMENT_ADMIN",
      companyId: "10000000-0000-4000-8000-000000000001",
      departmentId: "30000000-0000-4000-8000-000000000001",
    })).toThrow(/branch and department|branch before/i);
  });
});

describe("Create User progressive UI source contract", () => {
  it("starts with universal fields and reveals scoped customization only after role selection", async () => {
    const source = await readFile(
      new URL("../src/components/UserCreateForm.tsx", import.meta.url),
      "utf8",
    );
    expect(source).toContain('useState<UserRole | "">("")');
    expect(source).toContain('data-draft-id="create-user"');
    expect(source).toContain("roleChanged");
    expect(source).toContain("changeCompany");
    expect(source).toContain('setBranchId("")');
    expect(source).toContain('setDepartmentId("")');
    expect(source).toContain("PermissionChecklist");
    expect(source).toContain("permissionsCustomized");
    expect(source).toContain("customizablePermissions");
    expect(source).toContain("requesterScopeFixedToDepartment");
    expect(source).toContain(
      'role === "REQUESTER" && !requesterScopeFixedToDepartment',
    );
  });

  it("uses centralized English, Arabic and Malay role/access copy", async () => {
    const source = await readFile(
      new URL("../src/lib/user-form-i18n.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("Role overview");
    expect(source).toContain("Access included");
    expect(source).toContain("Role changed");
    expect(source).toMatch(/[\u0600-\u06ff]/u);
    expect(source).toContain("Peranan");
  });
});
