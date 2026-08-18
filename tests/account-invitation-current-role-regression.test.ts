import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  AccessManagementUnavailableError,
  replaceUserPermissionSetInTransaction,
} from "@/lib/access-management";
import type { SessionUser } from "@/lib/auth";
// @ts-expect-error The production email renderer is an intentional JavaScript module.
import { renderAccountSetupEmail } from "../server-tools/account-setup-email.mjs";

const currentInvitationRoles = [
  "HUMAN_RESOURCES_MANAGEMENT",
  "CLIENT_ACCOUNT_MANAGER",
  "DEPARTMENT_ADMIN",
  "DELIVERY_TEAM_SUPERVISOR",
  "DELIVERY_AGENT",
  "DELIVERY_GUY",
] as const;

const invitation = {
  recipientName: "Current Role User",
  recipientEmail: "current-role@example.test",
  companyName: "Axora",
  branchName: undefined,
  expiresAt: "2026-08-19T08:00:00.000Z",
  setupUrl: "https://axora.management/account/setup#token=abcdefghijklmnopqrstuvwxyzABCDEFGH123456789",
};

const owner: SessionUser = {
  id: "90000000-0000-4000-8000-000000000001",
  email: "owner@example.test",
  name: "Platform owner",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  roleAssignmentId: "90000000-0000-4000-8000-000000000002",
  isOwner: true,
};

describe("current account invitation contract", () => {
  it.each(currentInvitationRoles)(
    "renders the %s setup email without rejecting the role",
    async (role) => {
      for (const locale of ["en", "ar", "ms"] as const) {
        const rendered = await renderAccountSetupEmail(
          { ...invitation, role, locale },
          {
            appBaseUrl: "https://axora.management",
            supportEmail: "support@axora.management",
          },
        );

        expect(rendered.subject).toBeTruthy();
        expect(rendered.html).toContain("https://axora.management/account/setup#token=");
        expect(rendered.text).toContain(invitation.setupUrl);
      }
    },
  );

  it("allows every current platform invitation role in inspection and consumption", () => {
    const source = readFileSync(
      new URL("../src/lib/account-setup.ts", import.meta.url),
      "utf8",
    );
    const platformClauses = source.match(
      /intended_role\.role_key IN \(\s*'PLATFORM_OWNER'[\s\S]*?'TECHNICAL_SUPPORT'\s*\)/g,
    );

    expect(platformClauses).toHaveLength(2);
    for (const clause of platformClauses ?? []) {
      expect(clause).toContain("'HUMAN_RESOURCES_MANAGEMENT'");
      expect(clause).toContain("'CLIENT_ACCOUNT_MANAGER'");
      expect(clause).toContain("'PLATFORM_OPERATIONS'");
      expect(clause).toContain("'TECHNICAL_SUPPORT'");
    }
  });

  it("posts role defaults as defaults and marks only explicit edits as customized", () => {
    const form = readFileSync(
      new URL("../src/components/UserCreateForm.tsx", import.meta.url),
      "utf8",
    );
    const action = readFileSync(
      new URL("../src/app/(portal)/users/actions.ts", import.meta.url),
      "utf8",
    );

    expect(form).toContain('name="permissionsCustomized"');
    expect(form).toContain('value={permissionsCustomized ? "true" : "false"}');
    expect(action).toContain('readFormText(\n    formData,\n    "permissionsCustomized"');
    expect(action).toContain("permissions: permissionsCustomized");
    expect(action).toContain(": undefined");
  });

  it("converts database permission-set failures into a controlled domain error", async () => {
    const client = {
      query: vi.fn().mockRejectedValue(
        new Error("A selected permission is unavailable"),
      ),
    };

    await expect(replaceUserPermissionSetInTransaction(
      client as never,
      owner,
      {
        targetUserId: "90000000-0000-4000-8000-000000000003",
        targetRoleAssignmentId: "90000000-0000-4000-8000-000000000004",
        permissions: ["dashboard.view"],
        reason: "Invitation permission selection",
      },
    )).rejects.toBeInstanceOf(AccessManagementUnavailableError);
  });
});
