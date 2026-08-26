import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { mvpCategoryPolicyScopes, type CategoryPolicyScope } from "@/lib/category-policy";
import routeMatrix from "../scripts/production/authenticated-route-matrix.json";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("current branch-based MVP operating model", () => {
  it("omits historical department policies without changing stored compatibility rows", () => {
    const scopes: CategoryPolicyScope[] = [
      {
        type: "COMPANY", companyId: "company-a", companyName: "Company A",
        enabled: false, allowedCategories: [],
      },
      {
        type: "BRANCH", companyId: "company-a", companyName: "Company A",
        branchId: "branch-a", branchName: "Branch A",
        enabled: true, allowedCategories: ["Office"],
      },
      {
        type: "DEPARTMENT", companyId: "company-a", companyName: "Company A",
        branchId: "branch-a", branchName: "Branch A",
        departmentId: "department-a", departmentName: "Legacy department",
        enabled: true, allowedCategories: ["Office"],
      },
    ];

    expect(mvpCategoryPolicyScopes(scopes).map((scope) => scope.type))
      .toEqual(["COMPANY", "BRANCH"]);
    expect(scopes).toHaveLength(3);
  });

  it("redirects retired hierarchy routes and fails closed for stale actions", async () => {
    const [page, actions] = await Promise.all([
      source("src/app/(portal)/branches/organization/page.tsx"),
      source("src/app/(portal)/branches/organization/actions.ts"),
    ]);

    expect(page).toContain('permanentRedirect("/branches")');
    expect(page).not.toMatch(/loadOrganizationStructureWorkspace|StatusForm/);
    expect(actions.match(/permanentRedirect\("\/branches"\)/g)).toHaveLength(2);
    expect(actions.match(/requirePermission\("view_branches"\)/g)).toHaveLength(2);
    expect(actions).not.toContain("saveOrganizationNode(actor");
    expect(actions).not.toContain("setOrganizationNodeActive(actor");
    expect(routeMatrix.routes.find((route) => route.route === "/branches/organization"))
      .toMatchObject({ mode: "removed", expectedFinalUrl: "/branches" });
  });

  it("keeps retired hierarchy choices out of current write surfaces", async () => {
    const [companyUserPage, userForm, userActions, requestForm,
      requestActions, policyPage, policyActions] = await Promise.all([
        source("src/app/(portal)/companies/[companyId]/users/new/page.tsx"),
        source("src/components/UserCreateForm.tsx"),
        source("src/app/(portal)/users/actions.ts"),
        source("src/components/RequestForm.tsx"),
        source("src/app/(portal)/requests/actions.ts"),
        source("src/app/(portal)/settings/procurement/page.tsx"),
        source("src/app/(portal)/settings/procurement/actions.ts"),
      ]);

    expect(companyUserPage).toContain('role.key !== "DEPARTMENT_ADMIN"');
    expect(companyUserPage).not.toContain("loadOrganizationStructureWorkspace");
    expect(userForm).not.toMatch(/name="departmentId"|assignmentLevel/);
    expect(userActions).toContain('input.role === "DEPARTMENT_ADMIN"');
    expect(userActions).toContain("Boolean(input.departmentId)");
    expect(requestForm).not.toMatch(/name="department"|copy\.department/);
    expect(requestActions).toContain('department: ""');
    expect(policyPage).toContain("mvpCategoryPolicyScopes(workspace.scopes)");
    expect(policyPage).not.toContain('name="departmentId"');
    expect(policyActions).toContain('z.enum(["COMPANY", "BRANCH"])');
    expect(policyActions).not.toContain('formData.get("departmentId")');
  });
});
