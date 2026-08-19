import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  existingUserManagementMessages,
  existingUserManagementNotice,
} from "@/lib/existing-user-management-i18n";

async function source(path: string) {
  return readFile(path, "utf8");
}

describe("Prompt 5 existing-user management UI contract", () => {
  it("keeps People & Access as the single entry point for active, invited, and suspended users", async () => {
    const directory = await source("src/app/(portal)/users/page.tsx");
    expect(directory).toContain("/access");
    expect(directory).toContain("accountStatus !== \"DEACTIVATED\"");
    expect(directory).toContain("InvitationResendForm");
  });

  it("progressively selects company, branch, department, and Requester assignment level", async () => {
    const editor = await source("src/components/UserRoleScopeEditor.tsx");
    expect(editor).toContain("Change role & scope");
    expect(editor).toContain("requesterScope");
    expect(editor).toContain("companyId");
    expect(editor).toContain("branchId");
    expect(editor).toContain("departmentId");
    expect(editor).toContain("useFormStatus");
    expect(editor).toContain("disabled={disabled || pending}");
  });

  it("keeps email read-only and does not expose credential controls", async () => {
    const controls = await source("src/components/UserManagementControls.tsx");
    expect(controls).toContain("readOnly");
    expect(controls).toContain("snapshot.identity.email");
    expect(controls).not.toMatch(/passwordHash|sessionToken|invitationTokenHash|rawToken/);
  });

  it("does not silently canonicalize historical role keys into routine edit choices", async () => {
    const controls = await source("src/components/UserManagementControls.tsx");
    expect(controls).toContain("storedDefinition.key === storedRole");
    expect(controls).toContain("storedDefinition.availableForCreation !== false");
  });

  it("localizes Prompt 5 management and notices in English, Arabic, and Malay", () => {
    for (const locale of ["en", "ar", "ms"] as const) {
      const copy = existingUserManagementMessages(locale);
      expect(copy.profile).toBeTruthy();
      expect(copy.accountState).toBeTruthy();
      expect(copy.pendingTitle).toBeTruthy();
      expect(copy.approvalEditor).toBeTruthy();
      expect(existingUserManagementNotice(locale,"role-scope-updated")).toBeTruthy();
      expect(existingUserManagementNotice(locale,"account-deactivated")).toBeTruthy();
    }
  });
});
