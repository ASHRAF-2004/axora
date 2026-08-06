from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text()
    if old not in source:
        raise RuntimeError(f"Expected marker not found in {path}: {old[:120]!r}")
    target.write_text(source.replace(old, new, 1))


# Authenticated session identity, JWT, live lookup, and step-up binding.
replace_once(
    "src/lib/auth.ts",
    """interface StepUpClaim {
  actorId: string;
  sessionTokenHash: string;
  role: UserRole;
  accountKind: AccountKind;
  scopeType: RoleScopeType;
  companyId?: string;
  branchId?: string;
  supplierId?: string;
  roleAssignmentId?: string;
""",
    """interface StepUpClaim {
  actorId: string;
  sessionTokenHash: string;
  role: UserRole;
  accountKind: AccountKind;
  scopeType: RoleScopeType;
  companyId?: string;
  branchId?: string;
  departmentId?: string;
  supplierId?: string;
  roleAssignmentId?: string;
""",
)
replace_once(
    "src/lib/auth.ts",
    """export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId?: string;
  branchId?: string;
  supplierId?: string;
""",
    """export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  companyId?: string;
  branchId?: string;
  departmentId?: string;
  supplierId?: string;
""",
)
replace_once(
    "src/lib/auth.ts",
    """  scopeType?: string;
  companyId?: string;
  branchId?: string;
  supplierId?: string;
  scopeCompanyActive?: boolean;
  companyMembershipStatus?: string;
  companyMembershipPrimary?: boolean;
  scopeBranchActive?: boolean;
  branchAssignmentStatus?: string;
  branchAssignmentPrimary?: boolean;
  scopeSupplierActive?: boolean;
""",
    """  scopeType?: string;
  companyId?: string;
  branchId?: string;
  departmentId?: string;
  supplierId?: string;
  scopeCompanyActive?: boolean;
  companyMembershipStatus?: string;
  companyMembershipPrimary?: boolean;
  scopeBranchActive?: boolean;
  branchAssignmentStatus?: string;
  branchAssignmentPrimary?: boolean;
  scopeDepartmentActive?: boolean;
  scopeDepartmentBranchId?: string;
  departmentAssignmentStatus?: string;
  departmentAssignmentPrimary?: boolean;
  scopeSupplierActive?: boolean;
""",
)
replace_once(
    "src/lib/auth.ts",
    """    companyId: actor.companyId,
    branchId: actor.branchId,
    supplierId: actor.supplierId,
""",
    """    companyId: actor.companyId,
    branchId: actor.branchId,
    departmentId: actor.departmentId,
    supplierId: actor.supplierId,
""",
)
replace_once(
    "src/lib/auth.ts",
    """    assignment.scope_type AS \"scopeType\",
    assignment.company_id::text AS \"companyId\",
    assignment.branch_id::text AS \"branchId\",
    assignment.supplier_id::text AS \"supplierId\",
    scope_company.active AS \"scopeCompanyActive\",
    scope_membership.status AS \"companyMembershipStatus\",
    scope_membership.is_primary AS \"companyMembershipPrimary\",
    scope_branch.active AS \"scopeBranchActive\",
    scope_branch_assignment.status AS \"branchAssignmentStatus\",
    scope_branch_assignment.is_primary AS \"branchAssignmentPrimary\",
    scope_supplier.active AS \"scopeSupplierActive\",
""",
    """    assignment.scope_type AS \"scopeType\",
    assignment.company_id::text AS \"companyId\",
    assignment.branch_id::text AS \"branchId\",
    assignment.department_id::text AS \"departmentId\",
    assignment.supplier_id::text AS \"supplierId\",
    scope_company.active AS \"scopeCompanyActive\",
    scope_membership.status AS \"companyMembershipStatus\",
    scope_membership.is_primary AS \"companyMembershipPrimary\",
    scope_branch.active AS \"scopeBranchActive\",
    scope_branch_assignment.status AS \"branchAssignmentStatus\",
    scope_branch_assignment.is_primary AS \"branchAssignmentPrimary\",
    scope_department.active AS \"scopeDepartmentActive\",
    scope_department.branch_id::text AS \"scopeDepartmentBranchId\",
    scope_department_assignment.status AS \"departmentAssignmentStatus\",
    scope_department_assignment.is_primary AS \"departmentAssignmentPrimary\",
    scope_supplier.active AS \"scopeSupplierActive\",
""",
)
replace_once(
    "src/lib/auth.ts",
    """  LEFT JOIN branch_assignments scope_branch_assignment
    ON scope_branch_assignment.user_id=account.id
   AND scope_branch_assignment.company_id=assignment.company_id
   AND scope_branch_assignment.branch_id=assignment.branch_id
  LEFT JOIN suppliers scope_supplier ON scope_supplier.id=assignment.supplier_id
""",
    """  LEFT JOIN branch_assignments scope_branch_assignment
    ON scope_branch_assignment.user_id=account.id
   AND scope_branch_assignment.company_id=assignment.company_id
   AND scope_branch_assignment.branch_id=assignment.branch_id
  LEFT JOIN departments scope_department
    ON scope_department.id=assignment.department_id
   AND scope_department.company_id=assignment.company_id
  LEFT JOIN department_assignments scope_department_assignment
    ON scope_department_assignment.user_id=account.id
   AND scope_department_assignment.company_id=assignment.company_id
   AND scope_department_assignment.department_id=assignment.department_id
  LEFT JOIN suppliers scope_supplier ON scope_supplier.id=assignment.supplier_id
""",
)
replace_once(
    "src/lib/auth.ts",
    """const branchScopeRoles = new Set([
  \"BRANCH_ADMIN\",
  \"BRANCH_APPROVER\",
  \"REQUESTER\",
  \"FINANCE_REVIEWER\",
  \"AUDITOR\",
  \"RECEIVING_USER\",
  \"APPROVER\",
  \"OPERATIONS\",
  \"FINANCE\",
  \"VIEWER\",
]);
const legacyCompanyRoles = new Set([
""",
    """const branchScopeRoles = new Set([
  \"BRANCH_ADMIN\",
  \"BRANCH_APPROVER\",
  \"REQUESTER\",
  \"FINANCE_REVIEWER\",
  \"AUDITOR\",
  \"RECEIVING_USER\",
  \"APPROVER\",
  \"OPERATIONS\",
  \"FINANCE\",
  \"VIEWER\",
]);
const departmentScopeRoles = new Set([
  \"DEPARTMENT_ADMIN\",
  \"REQUESTER\",
  \"FINANCE_REVIEWER\",
  \"AUDITOR\",
  \"RECEIVING_USER\",
]);
const deliveryScopeRoles = new Set([
  \"DELIVERY_TEAM_SUPERVISOR\",
  \"DELIVERY_AGENT\",
  \"DELIVERY_DRIVER\",
]);
const legacyCompanyRoles = new Set([
""",
)
replace_once(
    "src/lib/auth.ts",
    """function roleFitsAccountScope(
  accountKind: AccountKind,
  isOwner: boolean,
  role: KnownUserRole,
  scopeType: RoleScopeType,
) {
  if (accountKind === \"PLATFORM\") {
    if (scopeType !== \"PLATFORM\") return false;
    return isOwner ? platformOwnerRoles.has(role) : platformActorRoles.has(role);
  }
  if (isOwner) return false;
  if (accountKind === \"COMPANY\") {
    return scopeType === \"COMPANY\"
      ? companyScopeRoles.has(role)
      : scopeType === \"BRANCH\" && branchScopeRoles.has(role);
  }
  if (accountKind === \"SUPPLIER\") {
    return scopeType === \"SUPPLIER\" && role === \"SUPPLIER_USER\";
  }
  return scopeType === \"DELIVERY\" && role === \"DELIVERY_DRIVER\";
}
""",
    """function roleFitsAccountScope(
  accountKind: AccountKind,
  isOwner: boolean,
  role: KnownUserRole,
  scopeType: RoleScopeType,
) {
  if (accountKind === \"PLATFORM\") {
    if (isOwner) {
      return scopeType === \"PLATFORM\" && platformOwnerRoles.has(role);
    }
    if (role === \"CLIENT_ACCOUNT_MANAGER\") return scopeType === \"COMPANY\";
    return scopeType === \"PLATFORM\" && platformActorRoles.has(role);
  }
  if (isOwner) return false;
  if (accountKind === \"COMPANY\") {
    if (scopeType === \"COMPANY\") return companyScopeRoles.has(role);
    if (scopeType === \"BRANCH\") return branchScopeRoles.has(role);
    return scopeType === \"DEPARTMENT\" && departmentScopeRoles.has(role);
  }
  if (accountKind === \"SUPPLIER\") {
    return scopeType === \"SUPPLIER\" && role === \"SUPPLIER_USER\";
  }
  return scopeType === \"DELIVERY\" && deliveryScopeRoles.has(role);
}
""",
)
replace_once(
    "src/lib/auth.ts",
    """function validAssignmentCandidate(row: IdentityCandidateRow) {
  if (!row.assignmentId || row.assignmentActive !== true || row.assignmentRevokedAt
    || !isUserRole(row.assignedRole) || !isAccountKind(row.accountKind)
    || !isRoleScopeType(row.scopeType)) return false;
  if (!roleFitsAccountScope(row.accountKind, row.isOwner, row.assignedRole, row.scopeType)) {
    return false;
  }
  if (row.scopeType === \"PLATFORM\") {
    return !row.companyId && !row.branchId && !row.supplierId;
  }
  if (row.scopeType === \"COMPANY\") {
    return Boolean(row.companyId) && !row.branchId && !row.supplierId
      && row.scopeCompanyActive === true
      && row.companyMembershipStatus === \"ACTIVE\";
  }
  if (row.scopeType === \"BRANCH\") {
    return Boolean(row.companyId && row.branchId) && !row.supplierId
      && row.scopeCompanyActive === true
      && row.companyMembershipStatus === \"ACTIVE\"
      && row.scopeBranchActive === true
      && row.branchAssignmentStatus === \"ACTIVE\";
  }
  if (row.scopeType === \"SUPPLIER\") {
    return Boolean(row.supplierId) && !row.companyId && !row.branchId
      && row.scopeSupplierActive === true
      && row.supplierMembershipStatus === \"ACTIVE\";
  }
  return !row.companyId && !row.branchId && !row.supplierId
    && row.deliveryProfileActive === true;
}
""",
    """function validAssignmentCandidate(row: IdentityCandidateRow) {
  if (!row.assignmentId || row.assignmentActive !== true || row.assignmentRevokedAt
    || !isUserRole(row.assignedRole) || !isAccountKind(row.accountKind)
    || !isRoleScopeType(row.scopeType)) return false;
  if (!roleFitsAccountScope(row.accountKind, row.isOwner, row.assignedRole, row.scopeType)) {
    return false;
  }
  if (row.scopeType === \"PLATFORM\") {
    return !row.companyId && !row.branchId && !row.departmentId && !row.supplierId;
  }
  if (row.scopeType === \"COMPANY\") {
    const platformManager = row.accountKind === \"PLATFORM\"
      && row.assignedRole === \"CLIENT_ACCOUNT_MANAGER\";
    return Boolean(row.companyId) && !row.branchId && !row.departmentId && !row.supplierId
      && row.scopeCompanyActive === true
      && (platformManager || (
        row.accountKind === \"COMPANY\"
        && row.companyMembershipStatus === \"ACTIVE\"
      ));
  }
  if (row.scopeType === \"BRANCH\") {
    return Boolean(row.companyId && row.branchId) && !row.departmentId && !row.supplierId
      && row.scopeCompanyActive === true
      && row.companyMembershipStatus === \"ACTIVE\"
      && row.scopeBranchActive === true
      && row.branchAssignmentStatus === \"ACTIVE\";
  }
  if (row.scopeType === \"DEPARTMENT\") {
    return Boolean(row.companyId && row.departmentId) && !row.supplierId
      && row.scopeCompanyActive === true
      && row.companyMembershipStatus === \"ACTIVE\"
      && row.scopeDepartmentActive === true
      && row.departmentAssignmentStatus === \"ACTIVE\"
      && (!row.branchId || row.scopeDepartmentBranchId === row.branchId);
  }
  if (row.scopeType === \"SUPPLIER\") {
    return Boolean(row.supplierId) && !row.companyId && !row.branchId
      && !row.departmentId
      && row.scopeSupplierActive === true
      && row.supplierMembershipStatus === \"ACTIVE\";
  }
  return !row.companyId && !row.branchId && !row.departmentId && !row.supplierId
    && (row.assignedRole === \"DELIVERY_TEAM_SUPERVISOR\"
      || row.deliveryProfileActive === true);
}
""",
)
replace_once(
    "src/lib/auth.ts",
    """  if (row.branchAssignmentPrimary === false) score += 1;
  return score;
""",
    """  if (row.branchAssignmentPrimary === false) score += 1;
  if (row.departmentAssignmentPrimary === false) score += 1;
  return score;
""",
)
replace_once(
    "src/lib/auth.ts",
    """    ...(row.companyId ? { companyId: row.companyId } : {}),
    ...(row.branchId ? { branchId: row.branchId } : {}),
    ...(row.supplierId ? { supplierId: row.supplierId } : {}),
""",
    """    ...(row.companyId ? { companyId: row.companyId } : {}),
    ...(row.branchId ? { branchId: row.branchId } : {}),
    ...(row.departmentId ? { departmentId: row.departmentId } : {}),
    ...(row.supplierId ? { supplierId: row.supplierId } : {}),
""",
)
replace_once(
    "src/lib/auth.ts",
    """  if (user.scopeType === \"PLATFORM\" || user.scopeType === \"DELIVERY\") {
    return !user.companyId && !user.branchId && !user.supplierId;
  }
  if (user.scopeType === \"SUPPLIER\") {
    return Boolean(user.supplierId) && !user.companyId && !user.branchId;
  }
  if (!user.companyId || user.supplierId) return false;
  return user.scopeType === \"BRANCH\" ? Boolean(user.branchId) : !user.branchId;
""",
    """  if (user.scopeType === \"PLATFORM\" || user.scopeType === \"DELIVERY\") {
    return !user.companyId && !user.branchId && !user.departmentId && !user.supplierId;
  }
  if (user.scopeType === \"SUPPLIER\") {
    return Boolean(user.supplierId) && !user.companyId && !user.branchId
      && !user.departmentId;
  }
  if (!user.companyId || user.supplierId) return false;
  if (user.scopeType === \"COMPANY\") return !user.branchId && !user.departmentId;
  if (user.scopeType === \"BRANCH\") return Boolean(user.branchId) && !user.departmentId;
  return user.scopeType === \"DEPARTMENT\" && Boolean(user.departmentId);
""",
)
replace_once(
    "src/lib/auth.ts",
    """    && tokenUser.companyId === liveUser.companyId
    && tokenUser.branchId === liveUser.branchId
    && tokenUser.supplierId === liveUser.supplierId
""",
    """    && tokenUser.companyId === liveUser.companyId
    && tokenUser.branchId === liveUser.branchId
    && tokenUser.departmentId === liveUser.departmentId
    && tokenUser.supplierId === liveUser.supplierId
""",
)
replace_once(
    "src/lib/auth.ts",
    """    companyId: user.companyId,
    branchId: user.branchId,
    supplierId: user.supplierId,
""",
    """    companyId: user.companyId,
    branchId: user.branchId,
    departmentId: user.departmentId,
    supplierId: user.supplierId,
""",
)
replace_once(
    "src/lib/auth.ts",
    """      ...(payload.companyId ? { companyId: String(payload.companyId) } : {}),
      ...(payload.branchId ? { branchId: String(payload.branchId) } : {}),
      ...(payload.supplierId ? { supplierId: String(payload.supplierId) } : {}),
""",
    """      ...(payload.companyId ? { companyId: String(payload.companyId) } : {}),
      ...(payload.branchId ? { branchId: String(payload.branchId) } : {}),
      ...(payload.departmentId ? { departmentId: String(payload.departmentId) } : {}),
      ...(payload.supplierId ? { supplierId: String(payload.supplierId) } : {}),
""",
)
replace_once(
    "src/lib/auth.ts",
    """    && ((claims.companyId ?? \"\") === (user.companyId ?? \"\"))
    && ((claims.branchId ?? \"\") === (user.branchId ?? \"\"))
    && ((claims.supplierId ?? \"\") === (user.supplierId ?? \"\"))
""",
    """    && ((claims.companyId ?? \"\") === (user.companyId ?? \"\"))
    && ((claims.branchId ?? \"\") === (user.branchId ?? \"\"))
    && ((claims.departmentId ?? \"\") === (user.departmentId ?? \"\"))
    && ((claims.supplierId ?? \"\") === (user.supplierId ?? \"\"))
""",
)

# Compatibility permission contracts now recognize department requesters and
# department-scoped finance/audit/receiving identities.
replace_once(
    "src/lib/permissions.ts",
    """    case \"BRANCH_ADMIN\":
    case \"REQUESTER\":
    case \"BRANCH_APPROVER\":
      return !subject.isOwner && validCompanyScope(subject, [\"BRANCH\"]);
    case \"DEPARTMENT_ADMIN\":
      return !subject.isOwner && validDepartmentScope(subject);
    case \"FINANCE_REVIEWER\":
    case \"AUDITOR\":
    case \"RECEIVING_USER\":
      return !subject.isOwner && validCompanyScope(subject, [\"COMPANY\", \"BRANCH\"]);
""",
    """    case \"BRANCH_ADMIN\":
    case \"BRANCH_APPROVER\":
      return !subject.isOwner && validCompanyScope(subject, [\"BRANCH\"]);
    case \"REQUESTER\":
      return !subject.isOwner && (
        validCompanyScope(subject, [\"BRANCH\"])
        || validDepartmentScope(subject)
      );
    case \"DEPARTMENT_ADMIN\":
      return !subject.isOwner && validDepartmentScope(subject);
    case \"FINANCE_REVIEWER\":
    case \"AUDITOR\":
    case \"RECEIVING_USER\":
      return !subject.isOwner && (
        validCompanyScope(subject, [\"COMPANY\", \"BRANCH\"])
        || validDepartmentScope(subject)
      );
""",
)

# Canonical role catalogue advertises every valid company child scope while
# keeping newly managed roles hidden until audited creation commands land.
replace_once(
    "src/lib/role-catalog.ts",
    """  { key: \"REQUESTER\", label: \"Purchase requester\", description: \"Shop and create purchase requests for one assigned branch.\", accountKind: \"COMPANY\", allowedScopes: [\"BRANCH\"], category: \"Company\" },
  { key: \"FINANCE_REVIEWER\", label: \"Finance reviewer\", description: \"Customer invoices, COD status, matching, and finance exceptions.\", accountKind: \"COMPANY\", allowedScopes: [\"COMPANY\", \"BRANCH\"], category: \"Company\" },
  { key: \"AUDITOR\", label: \"Read-only auditor\", description: \"Read-only evidence and audit history within the assigned scope.\", accountKind: \"COMPANY\", allowedScopes: [\"COMPANY\", \"BRANCH\"], category: \"Company\" },
  { key: \"RECEIVING_USER\", label: \"Receiving user\", description: \"Independent delivery inspection and receipt confirmation.\", accountKind: \"COMPANY\", allowedScopes: [\"COMPANY\", \"BRANCH\"], category: \"Company\" },
""",
    """  { key: \"REQUESTER\", label: \"Purchase requester\", description: \"Shop and create purchase requests for one assigned branch or department.\", accountKind: \"COMPANY\", allowedScopes: [\"BRANCH\", \"DEPARTMENT\"], category: \"Company\" },
  { key: \"FINANCE_REVIEWER\", label: \"Finance reviewer\", description: \"Customer invoices, COD status, matching, and finance exceptions.\", accountKind: \"COMPANY\", allowedScopes: [\"COMPANY\", \"BRANCH\", \"DEPARTMENT\"], category: \"Company\" },
  { key: \"AUDITOR\", label: \"Read-only auditor\", description: \"Read-only evidence and audit history within the assigned scope.\", accountKind: \"COMPANY\", allowedScopes: [\"COMPANY\", \"BRANCH\", \"DEPARTMENT\"], category: \"Company\" },
  { key: \"RECEIVING_USER\", label: \"Receiving user\", description: \"Independent delivery inspection and receipt confirmation.\", accountKind: \"COMPANY\", allowedScopes: [\"COMPANY\", \"BRANCH\", \"DEPARTMENT\"], category: \"Company\" },
""",
)

# Stable policy kernel aligns requester scope with the canonical hierarchy.
replace_once(
    "src/lib/authorization-policy.ts",
    """    case \"BRANCH_ADMIN\":
    case \"BRANCH_APPROVER\":
    case \"REQUESTER\":
      return { accountKind: \"COMPANY\" as const, scopes: [\"BRANCH\"] as const };
    case \"DEPARTMENT_ADMIN\":
      return { accountKind: \"COMPANY\" as const, scopes: [\"DEPARTMENT\"] as const };
""",
    """    case \"BRANCH_ADMIN\":
    case \"BRANCH_APPROVER\":
      return { accountKind: \"COMPANY\" as const, scopes: [\"BRANCH\"] as const };
    case \"REQUESTER\":
      return {
        accountKind: \"COMPANY\" as const,
        scopes: [\"BRANCH\", \"DEPARTMENT\"] as const,
      };
    case \"DEPARTMENT_ADMIN\":
      return { accountKind: \"COMPANY\" as const, scopes: [\"DEPARTMENT\"] as const };
""",
)

# Live effective access can now derive the exact department resource scope.
replace_once(
    "src/lib/effective-access.ts",
    """  if (user.scopeType === \"BRANCH\" && user.companyId && user.branchId) {
    return {
      type: \"BRANCH\",
      companyId: user.companyId,
      branchId: user.branchId,
    };
  }
  if (user.scopeType === \"SUPPLIER\" && user.supplierId) {
""",
    """  if (user.scopeType === \"BRANCH\" && user.companyId && user.branchId) {
    return {
      type: \"BRANCH\",
      companyId: user.companyId,
      branchId: user.branchId,
    };
  }
  if (user.scopeType === \"DEPARTMENT\" && user.companyId && user.departmentId) {
    return {
      type: \"DEPARTMENT\",
      companyId: user.companyId,
      ...(user.branchId ? { branchId: user.branchId } : {}),
      departmentId: user.departmentId,
    };
  }
  if (user.scopeType === \"SUPPLIER\" && user.supplierId) {
""",
)
replace_once(
    "tests/effective-access.test.ts",
    """  it(\"does not invent department context before department sessions are normalized\", async () => {
    mocks.isDemoMode.mockReturnValueOnce(true);
    await expect(loadEffectiveAccess(session({
      role: \"DEPARTMENT_ADMIN\",
      scopeType: \"DEPARTMENT\",
      companyId: ids.company,
      branchId: ids.branch,
      roleAssignmentId: undefined,
    }))).rejects.toBeInstanceOf(EffectiveAccessUnavailableError);
  });
""",
    """  it(\"preserves normalized department context in the compatibility boundary\", async () => {
    mocks.isDemoMode.mockReturnValueOnce(true);
    const department = await loadEffectiveAccess(session({
      role: \"DEPARTMENT_ADMIN\",
      scopeType: \"DEPARTMENT\",
      companyId: ids.company,
      branchId: ids.branch,
      departmentId: \"50000000-0000-4000-8000-000000000038\",
      roleAssignmentId: undefined,
    }));
    expect(department.subject.scopes).toEqual([{
      type: \"DEPARTMENT\",
      companyId: ids.company,
      branchId: ids.branch,
      departmentId: \"50000000-0000-4000-8000-000000000038\",
    }]);
  });
""",
)

# Read models retain department identity for administrative summaries.
replace_once(
    "src/lib/types.ts",
    """  companyId?: string; companyName?: string; branchId?: string; branchName?: string;
  supplierId?: string; supplierName?: string; jobTitle?: string;
""",
    """  companyId?: string; companyName?: string; branchId?: string; branchName?: string;
  departmentId?: string; departmentName?: string;
  supplierId?: string; supplierName?: string; jobTitle?: string;
""",
)
replace_once(
    "src/lib/users.ts",
    """    COALESCE(assignment.branch_id,u.branch_id)::text AS \"branchId\",b.name AS \"branchName\",
    assignment.supplier_id::text AS \"supplierId\",supplier.name AS \"supplierName\",
""",
    """    COALESCE(assignment.branch_id,u.branch_id)::text AS \"branchId\",b.name AS \"branchName\",
    assignment.department_id::text AS \"departmentId\",department.name AS \"departmentName\",
    assignment.supplier_id::text AS \"supplierId\",supplier.name AS \"supplierName\",
""",
)
replace_once(
    "src/lib/users.ts",
    """      SELECT current_assignment.id,current_assignment.role_id,current_assignment.scope_type,
        current_assignment.company_id,current_assignment.branch_id,current_assignment.supplier_id
""",
    """      SELECT current_assignment.id,current_assignment.role_id,current_assignment.scope_type,
        current_assignment.company_id,current_assignment.branch_id,
        current_assignment.department_id,current_assignment.supplier_id
""",
)
replace_once(
    "src/lib/users.ts",
    """    LEFT JOIN branches b ON b.id=COALESCE(assignment.branch_id,u.branch_id)
    LEFT JOIN suppliers supplier ON supplier.id=assignment.supplier_id
""",
    """    LEFT JOIN branches b ON b.id=COALESCE(assignment.branch_id,u.branch_id)
    LEFT JOIN departments department
      ON department.id=assignment.department_id
     AND department.company_id=assignment.company_id
    LEFT JOIN suppliers supplier ON supplier.id=assignment.supplier_id
""",
)

# Migration-chain assertions advance with the new forward-only migration.
replace_once(
    "tests/full-migration-chain.test.ts",
    """  it(\"applies every numbered migration through 037 to an empty database\", async () => {
""",
    """  it(\"applies every numbered migration through 038 to an empty database\", async () => {
""",
)
replace_once(
    "tests/full-migration-chain.test.ts",
    """      expect(available.slice(-5)).toEqual([
        \"033_public_visitor_choice_counter.sql\",
        \"034_public_visitor_network_fallback.sql\",
        \"035_public_visitor_network_uniqueness.sql\",
        \"036_authorization_policy_foundation.sql\",
        \"037_effective_access_snapshot.sql\",
      ]);
""",
    """      expect(available.slice(-5)).toEqual([
        \"034_public_visitor_network_fallback.sql\",
        \"035_public_visitor_network_uniqueness.sql\",
        \"036_authorization_policy_foundation.sql\",
        \"037_effective_access_snapshot.sql\",
        \"038_canonical_session_scopes.sql\",
      ]);
""",
)
replace_once(
    "tests/full-migration-chain.test.ts",
    """      await db.exec(await readFile(
        migrationUrl(\"037_effective_access_snapshot.sql\"),
        \"utf8\",
      ));

      const after = await db.query<{
""",
    """      await db.exec(await readFile(
        migrationUrl(\"037_effective_access_snapshot.sql\"),
        \"utf8\",
      ));
      await db.exec(await readFile(
        migrationUrl(\"038_canonical_session_scopes.sql\"),
        \"utf8\",
      ));

      const after = await db.query<{
""",
)
replace_once(
    "tests/full-migration-chain.test.ts",
    """  it(\"keeps reset migration discovery dynamic through 037 while bootstrap retains its 032 minimum\", async () => {
""",
    """  it(\"keeps reset migration discovery dynamic through 038 while bootstrap retains its 032 minimum\", async () => {
""",
)
replace_once(
    "tests/full-migration-chain.test.ts",
    """|036_authorization|037_effective/);
    expect(reset).not.toMatch(/024_canonical|025_customer|026_workflow|027_receipt|028_email|029_delivery|030_email|031_support|032_user|033_public|034_public|035_public|036_authorization|037_effective/);
""",
    """|036_authorization|037_effective|038_canonical/);
    expect(reset).not.toMatch(/024_canonical|025_customer|026_workflow|027_receipt|028_email|029_delivery|030_email|031_support|032_user|033_public|034_public|035_public|036_authorization|037_effective|038_canonical/);
""",
)
