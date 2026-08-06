from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text()
    count = source.count(old)
    if count != 1:
        raise RuntimeError(
            f"{path}: expected one match, found {count} for {old[:100]!r}"
        )
    target.write_text(source.replace(old, new, 1))


policy = "src/lib/authorization-policy.ts"

replace_once(
    policy,
    """export interface PermissionDelegation {
  active: boolean;
  startsAt: Date;
  endsAt: Date;
  permissions: readonly PermissionCode[];
  scopes: readonly AuthorizationScope[];
}

export interface ApprovalLimit {""",
    """export interface PermissionDelegation {
  active: boolean;
  startsAt: Date;
  endsAt: Date;
  permissions: readonly PermissionCode[];
  scopes: readonly AuthorizationScope[];
}

export interface PermissionOverride {
  permission: PermissionCode;
  effect: "GRANT" | "DENY";
  scope: AuthorizationScope;
  active: boolean;
  startsAt?: Date;
  endsAt?: Date;
}

export interface ApprovalLimit {""",
)

replace_once(
    policy,
    """  scopes: readonly AuthorizationScope[];
  explicitGrants?: readonly PermissionCode[];
  explicitDenies?: readonly PermissionCode[];
  delegations?: readonly PermissionDelegation[];
  approvalLimits?: readonly ApprovalLimit[];
}""",
    """  scopes: readonly AuthorizationScope[];
  roleGrants?: readonly PermissionCode[];
  permissionOverrides?: readonly PermissionOverride[];
  explicitGrants?: readonly PermissionCode[];
  explicitDenies?: readonly PermissionCode[];
  delegations?: readonly PermissionDelegation[];
  approvalLimits?: readonly ApprovalLimit[];
}""",
)

replace_once(
    policy,
    """function permissionSource(
  subject: AuthorizationSubject,
  permission: PermissionCode,
  resource: AuthorizationResource,
  now: Date,
) {
  if (subject.explicitDenies?.includes(permission)) return undefined;
  if (subject.explicitGrants?.includes(permission)) return "EXPLICIT_GRANT" as const;
  if (defaultPermissionsForRole(
    subject.role,
    subject.scopes[0]?.type,
    subject.isOwner,
  ).includes(permission)) {
    return "ROLE" as const;
  }
  if (activeDelegations(subject, now).some((delegation) => (
    delegation.permissions.includes(permission)
      && delegation.scopes.some((scope) => scopeContains(scope, resource.scope))
  ))) {
    return "DELEGATION" as const;
  }
  return undefined;
}""",
    """function activeMatchingOverrides(
  subject: AuthorizationSubject,
  permission: PermissionCode,
  resource: AuthorizationResource,
  now: Date,
) {
  return (subject.permissionOverrides ?? []).filter((override) => (
    override.active
      && override.permission === permission
      && (!override.startsAt || override.startsAt.getTime() <= now.getTime())
      && (!override.endsAt || override.endsAt.getTime() > now.getTime())
      && scopeContains(override.scope, resource.scope)
  ));
}

function permissionSource(
  subject: AuthorizationSubject,
  permission: PermissionCode,
  resource: AuthorizationResource,
  now: Date,
) {
  const matchingOverrides = activeMatchingOverrides(
    subject,
    permission,
    resource,
    now,
  );
  if (subject.explicitDenies?.includes(permission)
    || matchingOverrides.some((override) => override.effect === "DENY")) {
    return undefined;
  }
  if (subject.explicitGrants?.includes(permission)
    || matchingOverrides.some((override) => override.effect === "GRANT")) {
    return "EXPLICIT_GRANT" as const;
  }
  const rolePermissions = subject.roleGrants
    ?? defaultPermissionsForRole(
      subject.role,
      subject.scopes[0]?.type,
      subject.isOwner,
    );
  if (rolePermissions.includes(permission)) return "ROLE" as const;
  if (activeDelegations(subject, now).some((delegation) => (
    delegation.permissions.includes(permission)
      && delegation.scopes.some((scope) => scopeContains(scope, resource.scope))
  ))) {
    return "DELEGATION" as const;
  }
  return undefined;
}""",
)

replace_once(
    policy,
    """  if (!subject.scopes.some((scope) => scopeContains(scope, resource.scope))) {
    return {
      allowed: false,
      permission: input.permission,
      reason: "RESOURCE_OUT_OF_SCOPE",
    };
  }

  const isSelfApproval""",
    """  const delegatedScopes = activeDelegations(subject, now)
    .flatMap((delegation) => delegation.scopes);
  if (!subject.scopes.some((scope) => scopeContains(scope, resource.scope))
    && !delegatedScopes.some((scope) => scopeContains(scope, resource.scope))) {
    return {
      allowed: false,
      permission: input.permission,
      reason: "RESOURCE_OUT_OF_SCOPE",
    };
  }

  const isSelfApproval""",
)

policy_test = Path("tests/authorization-policy.test.ts")
source = policy_test.read_text()
marker = 'describe("live policy facts", () => {'
if marker not in source:
    source += """

describe("live policy facts", () => {
  const companyA = { type: "COMPANY" as const, companyId: "company-a" };
  const companyB = { type: "COMPANY" as const, companyId: "company-b" };
  const now = new Date("2026-08-06T05:00:00.000Z");

  function liveApprover() {
    return {
      userId: "approver-1",
      role: "COMPANY_APPROVER" as const,
      accountKind: "COMPANY" as const,
      accountStatus: "ACTIVE" as const,
      isOwner: false,
      scopes: [companyA, companyB],
      roleGrants: ["request.approve.other" as const],
      permissionOverrides: [],
      delegations: [],
      approvalLimits: [{
        permission: "request.approve.other" as const,
        currency: "MYR",
        maximumAmount: 1000,
        allowSelfApproval: false,
        active: true,
        scope: companyA,
      }, {
        permission: "request.approve.other" as const,
        currency: "MYR",
        maximumAmount: 1000,
        allowSelfApproval: false,
        active: true,
        scope: companyB,
      }],
    };
  }

  it("uses the live database role grant set instead of stale static defaults", () => {
    expect(authorize({
      subject: liveApprover(),
      permission: "request.approve.other",
      resource: { scope: companyA, amount: 500, currency: "MYR" },
      now,
    })).toMatchObject({ allowed: true, source: "ROLE" });

    expect(authorize({
      subject: { ...liveApprover(), roleGrants: [] },
      permission: "request.approve.other",
      resource: { scope: companyA, amount: 500, currency: "MYR" },
      now,
    })).toMatchObject({ allowed: false, reason: "PERMISSION_DENIED" });
  });

  it("applies a scoped denial only to its matching company", () => {
    const subject = {
      ...liveApprover(),
      permissionOverrides: [{
        permission: "request.approve.other" as const,
        effect: "DENY" as const,
        scope: companyA,
        active: true,
        startsAt: new Date("2026-08-06T04:00:00.000Z"),
        endsAt: new Date("2026-08-06T06:00:00.000Z"),
      }],
    };
    expect(authorize({
      subject,
      permission: "request.approve.other",
      resource: { scope: companyA, amount: 100, currency: "MYR" },
      now,
    })).toMatchObject({ allowed: false, reason: "PERMISSION_DENIED" });
    expect(authorize({
      subject,
      permission: "request.approve.other",
      resource: { scope: companyB, amount: 100, currency: "MYR" },
      now,
    })).toMatchObject({ allowed: true, source: "ROLE" });
  });

  it("allows an active delegation to extend both permission and scope", () => {
    const subject = {
      userId: "auditor-1",
      role: "AUDITOR" as const,
      accountKind: "COMPANY" as const,
      accountStatus: "ACTIVE" as const,
      isOwner: false,
      scopes: [companyA],
      roleGrants: [],
      permissionOverrides: [],
      delegations: [{
        active: true,
        startsAt: new Date("2026-08-06T04:00:00.000Z"),
        endsAt: new Date("2026-08-06T06:00:00.000Z"),
        permissions: ["request.view" as const],
        scopes: [companyB],
      }],
      approvalLimits: [],
    };
    expect(authorize({
      subject,
      permission: "request.view",
      resource: { scope: companyB },
      now,
    })).toMatchObject({ allowed: true, source: "DELEGATION" });
  });

  it("ignores expired scoped overrides", () => {
    expect(authorize({
      subject: {
        ...liveApprover(),
        permissionOverrides: [{
          permission: "request.approve.other" as const,
          effect: "DENY" as const,
          scope: companyA,
          active: true,
          endsAt: new Date("2026-08-06T04:59:59.000Z"),
        }],
      },
      permission: "request.approve.other",
      resource: { scope: companyA, amount: 100, currency: "MYR" },
      now,
    })).toMatchObject({ allowed: true, source: "ROLE" });
  });
});
"""
policy_test.write_text(source)

replace_once(
    "tests/authorization-foundation-migration.test.ts",
    """      const applied = await applyMigrations(db);
      expect(applied.at(-1)).toBe(
        "036_authorization_policy_foundation.sql",
      );""",
    """      const applied = await applyMigrations(db, {
        through: "036_authorization_policy_foundation.sql",
      });
      expect(applied.at(-1)).toBe(
        "036_authorization_policy_foundation.sql",
      );""",
)

full_path = Path("tests/full-migration-chain.test.ts")
full = full_path.read_text()
full = full.replace(
    'it("applies every numbered migration through 036 to an empty database"',
    'it("applies every numbered migration through 037 to an empty database"',
)
full, count = re.subn(
    r'expect\(available\.slice\(-5\)\)\.toEqual\(\[.*?\]\);',
    'expect(available.slice(-5)).toEqual([\n'
    '        "033_public_visitor_choice_counter.sql",\n'
    '        "034_public_visitor_network_fallback.sql",\n'
    '        "035_public_visitor_network_uniqueness.sql",\n'
    '        "036_authorization_policy_foundation.sql",\n'
    '        "037_effective_access_snapshot.sql",\n'
    '      ]);',
    full,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError("full migration chain: latest migration list not found")
needle = """      await db.exec(await readFile(
        migrationUrl("036_authorization_policy_foundation.sql"),
        "utf8",
      ));
"""
if full.count(needle) != 1:
    raise RuntimeError("full migration chain: migration 036 block not unique")
full = full.replace(
    needle,
    needle + """      await db.exec(await readFile(
        migrationUrl("037_effective_access_snapshot.sql"),
        "utf8",
      ));
""",
    1,
)
full = full.replace(
    'it("keeps reset migration discovery dynamic through 036 while bootstrap retains its 032 minimum"',
    'it("keeps reset migration discovery dynamic through 037 while bootstrap retains its 032 minimum"',
)
full = full.replace(
    '035_public|036_authorization/);',
    '035_public|036_authorization|037_effective/);',
)
full_path.write_text(full)

for path in [
    "tests/support-diagnostics-migration.test.ts",
    "tests/account-security-session-audit-migration.test.ts",
]:
    target = Path(path)
    source = target.read_text()
    old = 'expect(applied.at(-1)).toBe("036_authorization_policy_foundation.sql");'
    new = 'expect(applied.at(-1)).toBe("037_effective_access_snapshot.sql");'
    if source.count(old) != 1:
        raise RuntimeError(f"{path}: latest migration assertion not unique")
    target.write_text(source.replace(old, new, 1))

auth_doc = Path("docs/refactor/AUTHORIZATION_POLICY.md")
doc = auth_doc.read_text()
doc_marker = "Status: implemented as an expand-compatible foundation. Existing production\n"
if doc.count(doc_marker) != 1:
    raise RuntimeError("Authorization policy status marker is not unique")
doc = doc.replace(
    doc_marker,
    "Status: implemented as an expand-compatible foundation. See "
    "[Live effective-access runtime](EFFECTIVE_ACCESS_RUNTIME.md) for the "
    "authenticated request integration. Existing production\n",
    1,
)
auth_doc.write_text(doc)
