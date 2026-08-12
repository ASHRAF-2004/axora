import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const pageUrl = new URL(
  "../src/app/(portal)/users/[id]/access/page.tsx",
  import.meta.url,
);
const actionsUrl = new URL(
  "../src/app/(portal)/users/[id]/access/actions.ts",
  import.meta.url,
);
const usersUrl = new URL(
  "../src/app/(portal)/users/page.tsx",
  import.meta.url,
);
const copyUrl = new URL(
  "../src/lib/access-administration-i18n.ts",
  import.meta.url,
);

describe("access administration UI contract", () => {
  it("renders a scoped, labeled, localized administration surface without raw policy access", async () => {
    const [page, copy] = await Promise.all([
      readFile(pageUrl, "utf8"),
      readFile(copyUrl, "utf8"),
    ]);

    expect(page).toContain('requirePagePermission("manage_users")');
    expect(page).toContain("loadAccessAdministration(actor, id, query.assignment)");
    expect(page).toContain("notFound()");
    expect(page).toContain("<PageHeader");
    expect(page).toContain("<table className=\"data-table\"");
    expect(page).toContain("<label");
    expect(page).toContain('role="status"');
    expect(page).toContain('name="reason"');
    expect(page).toContain("maxLength={500}");
    expect(page).toContain("snapshot.canManagePermissions");
    expect(page).toContain("override.manageable");
    expect(page).toContain("snapshot.canViewHistory");
    expect(page).not.toContain("dangerouslySetInnerHTML");
    expect(page).not.toMatch(/FROM\s+(user_permission_overrides|approval_limits|delegated_access)/i);

    expect(copy).toContain("const ar:");
    expect(copy).toContain("const ms:");
    expect(copy).toContain("المنع الصريح");
    expect(copy).toContain("Penafian jelas");
  });

  it("binds mutation scope on the server without routine password step-up and exposes only async server actions", async () => {
    const actions = await readFile(actionsUrl, "utf8");
    expect(actions).toContain('"use server"');
    expect(actions).toContain('requirePermission("manage_users")');
    expect(actions).not.toContain("requireRecentStepUp");
    expect(actions).toContain("setUserPermissionOverride(actor");
    expect(actions).toContain("removeUserPermissionOverride(actor");
    expect(actions).toContain("scopeType: string");
    expect(actions).toContain("companyId: string | undefined");
    expect(actions).toContain("targetRoleAssignmentId: string");
    expect(actions).not.toContain("user_permission_overrides");
    expect(actions).not.toMatch(/^export\s+(const|let|var|class)\s/m);
    expect(actions.match(/^export\s+async\s+function\s/gm)).toHaveLength(2);
  });

  it("links established user rows to access administration without replacing protected-account controls", async () => {
    const users = await readFile(usersUrl, "utf8");
    expect(users).toContain("accessAdministrationMessages(locale)");
    expect(users).toContain("`/users/${user.id}/access`");
    expect(users).toContain("canOpenAccess");
    expect(users).toContain("protectedLabel");
    expect(users).toContain("setUserActiveAction");
  });
});
