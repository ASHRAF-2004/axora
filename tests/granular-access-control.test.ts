import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { UserCreateForm } from "@/components/UserCreateForm";
import {
  defaultPermissionsForRole,
  type PermissionCode,
} from "@/lib/authorization-policy";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { creatableAccountRoles } from "@/lib/role-catalog";
import { accessGroupsForPermissions } from "@/lib/user-provisioning";

function platformActor(
  effectivePermissions: AuthenticatedSessionUser["effectivePermissions"],
): AuthenticatedSessionUser {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "synthetic-admin@example.test",
    name: "Synthetic administrator",
    role: "PLATFORM_OPERATIONS",
    accountKind: "PLATFORM",
    scopeType: "PLATFORM",
    roleAssignmentId: "22222222-2222-4222-8222-222222222222",
    isOwner: false,
    authVersion: 1,
    effectivePermissions,
  };
}

describe("granular role templates and effective access", () => {
  it("keeps the platform owner as the complete recovery authority", () => {
    const permissions = defaultPermissionsForRole(
      "PLATFORM_OWNER",
      "PLATFORM",
      true,
    );
    expect(permissions).toContain("platform_user.permission.manage");
    expect(permissions).toContain("company.view.all");
    expect(permissions).toContain("analytics.revenue.view");
    expect(permissions).toContain("commercial.platform_margin.view");
  });

  it("keeps product management independent from revenue and profit", () => {
    const permissions = defaultPermissionsForRole(
      "PLATFORM_OPERATIONS",
      "PLATFORM",
      false,
    );
    expect(permissions).toContain("product.manage");
    expect(permissions).toContain("commercial.cost.view");
    expect(permissions).not.toContain("analytics.revenue.view");
    expect(permissions).not.toContain("commercial.platform_margin.view");
  });

  it("does not conflate company-user and Axora-user creation", () => {
    const actor = platformActor(["manage_users", "create_company_users"]);
    const roles = creatableAccountRoles(actor);
    expect(roles.some((role) => role.accountKind === "COMPANY")).toBe(true);
    expect(roles.some((role) => role.accountKind === "PLATFORM")).toBe(false);
    expect(canAccess(actor, "create_company_users")).toBe(true);
    expect(canAccess(actor, "create_platform_users")).toBe(false);
  });

  it("keeps initial Create User progressive and derives access without a permission matrix", () => {
    const code: PermissionCode = "company_user.create";
    const markup = renderToStaticMarkup(createElement(UserCreateForm, {
      actorIsOwner: false,
      actorCompanyId: "33333333-3333-4333-8333-333333333333",
      branches: [],
      companies: [],
      defaultLocale: "en",
      roleOptions: [{
        value: "COMPANY_ADMIN",
        label: "Company administrator",
        description: "Company administration",
        category: "Company",
        defaultPermissions: [code],
      }],
    }));
    expect(markup).not.toContain("Access included");
    expect(markup).not.toContain("Reset to role defaults");
    expect(markup).not.toContain('name="permissions"');
    expect(accessGroupsForPermissions([code])).toEqual(["User Management"]);
  });
});

describe("migration 078 security boundaries", () => {
  const sql = readFileSync(
    new URL("../database/migrations/078_granular_permissions_company_assignments.sql", import.meta.url),
    "utf8",
  );

  it("uses the existing assignment relationship and deny-by-default scope gate", () => {
    expect(sql).toContain("public.company_assignments");
    expect(sql).toContain("company.view.all");
    expect(sql).toContain("axora_company_assignment_allows_permission");
    expect(sql).toContain("company_creator_primary_assignment");
    expect(sql).toContain("axora_actor_company_accessible");
    expect(sql).not.toMatch(/GRANT\s+SELECT\s+ON\s+(?:TABLE\s+)?public\.company_assignments/i);
  });

  it("maps legacy user capabilities to account-kind-specific authority", () => {
    expect(sql).toContain("axora_scoped_user_permission_code");
    expect(sql).toContain("platform_user.create");
    expect(sql).toContain("company_user.create");
    expect(sql).toContain("delivery_user.create");
  });

  it("redacts buying cost and supplier identity in PostgreSQL", () => {
    expect(sql).toContain("CASE WHEN can_view_cost THEN offer.base_cost ELSE 0 END");
    expect(sql).toContain("CASE WHEN can_view_supplier THEN supplier.name END");
    expect(sql).toContain("cost data redacted");
  });

  it("keeps permission replacement audited and grant-subset constrained", () => {
    expect(sql).toContain("axora_replace_user_permission_set");
    expect(sql).toContain("The actor cannot grant permission");
    expect(sql).toContain("permission_change_history");
    expect(sql).toContain("axora_invalidate_authorization_sessions");
  });
});
