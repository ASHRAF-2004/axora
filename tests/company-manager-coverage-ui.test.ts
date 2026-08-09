import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { companyLifecycleMessages } from "../src/lib/company-lifecycle-i18n";

const pageUrl = new URL("../src/app/(portal)/companies/page.tsx", import.meta.url);
const actionUrl = new URL("../src/app/(portal)/masters/actions.ts", import.meta.url);
const repositoryUrl = new URL("../src/lib/company-lifecycle.ts", import.meta.url);

describe("company manager coverage UI", () => {
  it("presents workload, access, transfer, handover, and history controls through the existing responsive page", async () => {
    const [page, action, repository] = await Promise.all([
      readFile(pageUrl, "utf8"),
      readFile(actionUrl, "utf8"),
      readFile(repositoryUrl, "utf8"),
    ]);
    expect(page).toContain('name="accessMode"');
    expect(page).toContain('name="specificPermissionCodes"');
    expect(page).toContain('name="documentVisibility"');
    expect(page).toContain('name="handoverNotes"');
    expect(page).toContain('name="handoverChecklist"');
    expect(page).toContain("manager.activePrimaryAssignments");
    expect(page).toContain("company.openManagerWork");
    expect(page).toContain("company.assignmentHistory");
    expect(page).toContain("marginBlockStart");
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
