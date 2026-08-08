import { describe, expect, it } from "vitest";
import { canAccess } from "@/lib/permissions";

const departmentRequester = {
  role: "REQUESTER" as const,
  isOwner: false,
  accountKind: "COMPANY" as const,
  scopeType: "DEPARTMENT" as const,
  companyId: "company-a",
  departmentId: "department-hr",
};

describe("P1-05 permission-based purchasing", () => {
  it("allows product, cart, and request work without budget or approval authority", () => {
    expect(canAccess(departmentRequester, "view_catalog")).toBe(true);
    expect(canAccess(departmentRequester, "create_requests")).toBe(true);
    expect(canAccess(departmentRequester, "view_budgets")).toBe(false);
    expect(canAccess(departmentRequester, "approve_requests")).toBe(false);
  });

  it("does not derive purchasing authority from an HR or executive job title", () => {
    const titledRequester = { ...departmentRequester, jobTitle: "HR specialist" };
    const renamedRequester = { ...departmentRequester, jobTitle: "Executive assistant" };
    expect(canAccess(titledRequester, "create_requests"))
      .toBe(canAccess(renamedRequester, "create_requests"));

    const titledAuditor = {
      ...departmentRequester,
      role: "AUDITOR" as const,
      jobTitle: "Head of Human Resources",
    };
    expect(canAccess(titledAuditor, "create_requests")).toBe(false);
  });
});
