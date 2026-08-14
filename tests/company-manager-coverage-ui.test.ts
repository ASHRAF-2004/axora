import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { companyLifecycleMessages } from "../src/lib/company-lifecycle-i18n";

const pageUrl = new URL("../src/app/(portal)/companies/page.tsx", import.meta.url);
const detailUrl = new URL("../src/app/(portal)/companies/[companyId]/page.tsx", import.meta.url);
const actionUrl = new URL("../src/app/(portal)/masters/actions.ts", import.meta.url);
const repositoryUrl = new URL("../src/lib/company-lifecycle.ts", import.meta.url);

describe("company manager coverage UI", () => {
  it("presents workload, access, transfer, handover, and history controls through the existing responsive page", async () => {
    const [page, detail, action, repository] = await Promise.all([
      readFile(pageUrl, "utf8"),
      readFile(detailUrl, "utf8"),
      readFile(actionUrl, "utf8"),
      readFile(repositoryUrl, "utf8"),
    ]);
    expect(page).not.toContain('name="accessMode"');
    expect(detail).toContain('name="accessMode"');
    expect(detail).toContain('name="specificPermissionCodes"');
    expect(detail).toContain('name="documentVisibility"');
    expect(detail).toContain('name="handoverNotes"');
    expect(detail).toContain('name="handoverChecklist"');
    expect(detail).toContain("manager.activePrimaryAssignments");
    expect(detail).toContain("company.openManagerWork");
    expect(detail).toContain("company.assignmentHistory");
    expect(detail).toContain("marginBlockStart");
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
