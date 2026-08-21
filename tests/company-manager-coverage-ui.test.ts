import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { companyLifecycleMessages } from "../src/lib/company-lifecycle-i18n";

const pageUrl = new URL("../src/app/(portal)/companies/page.tsx", import.meta.url);
const detailUrl = new URL("../src/app/(portal)/companies/[companyId]/page.tsx", import.meta.url);
const assignmentUrl = new URL("../src/app/(portal)/companies/[companyId]/assignment/page.tsx", import.meta.url);
const workspaceUrl = new URL("../src/components/CompanyManagerAssignmentWorkspace.tsx", import.meta.url);
const actionUrl = new URL("../src/app/(portal)/masters/actions.ts", import.meta.url);
const repositoryUrl = new URL("../src/lib/company-lifecycle.ts", import.meta.url);

describe("company manager coverage UI", () => {
  it("presents workload, access, transfer, handover, and history controls through the existing responsive page", async () => {
    const [page, detail, assignment, workspace, action, repository] = await Promise.all([
      readFile(pageUrl, "utf8"),
      readFile(detailUrl, "utf8"),
      readFile(assignmentUrl, "utf8"),
      readFile(workspaceUrl, "utf8"),
      readFile(actionUrl, "utf8"),
      readFile(repositoryUrl, "utf8"),
    ]);
    expect(page).not.toContain('name="accessMode"');
    expect(detail).toContain("/assignment");
    expect(assignment).toContain("actor.isOwner");
    expect(assignment).toContain("CompanyManagerAssignmentWorkspace");
    expect(workspace).toContain('name="accessMode"');
    expect(workspace).toContain('name="specificPermissionCodes"');
    expect(workspace).toContain('name="documentVisibility"');
    expect(workspace).toContain('name="handoverNotes"');
    expect(workspace).toContain('name="handoverChecklist"');
    expect(workspace).toContain("manager.activePrimaryAssignments");
    expect(workspace).toContain("company.openManagerWork");
    expect(workspace).toContain("company.assignmentHistory");
    expect(workspace).toContain("marginBlockStart");
    expect(action).toContain("COMPANY_MANAGER_ACCESS_MODES");
    expect(action).toContain("handoverChecklist");
    expect(repository).toContain("axora_manage_company_assignment");
    expect(repository).toContain("eventSequence ?? mutation.companyVersion");
  });

  it.each(["en", "ar", "ms"] as const)(
    "ships complete %s manager coverage copy",
    (locale) => {
      const copy = companyLifecycleMessages(locale);
      for (const value of [
        copy.coverageAndHandover,
        copy.transferPreview,
        copy.accessMode,
        copy.specificPermissions,
        copy.documentVisibility,
        copy.handoverNotes,
        copy.assignmentHistory,
        copy.coverageGap,
      ]) expect(value.trim().length).toBeGreaterThan(2);
    },
  );
});
