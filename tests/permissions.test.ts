import { describe, expect, it } from "vitest";
import { hasPermission, type Permission } from "@/lib/permissions";
import type { UserRole } from "@/lib/types";

describe("role permissions", () => {
  const expected: Record<UserRole, Permission[]> = {
    ADMIN: ["manage_masters", "manage_requests", "manage_sourcing", "manage_approvals", "manage_deliveries", "manage_finance", "manage_documents", "view_audit", "manage_users", "manage_settings"],
    OPERATIONS: ["manage_masters", "manage_requests", "manage_sourcing", "manage_deliveries", "manage_documents"],
    FINANCE: ["manage_finance", "manage_documents"],
    VIEWER: ["view_audit"],
    IT_SUPPORT: ["manage_settings"],
  };

  const allPermissions = expected.ADMIN;
  for (const [role, allowed] of Object.entries(expected) as Array<[UserRole, Permission[]]>) {
    it(`grants only the intended ${role} capabilities`, () => {
      for (const permission of allPermissions) {
        expect(hasPermission(role, permission), `${role} / ${permission}`).toBe(allowed.includes(permission));
      }
    });
  }
});
