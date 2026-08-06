from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text()
    if old not in source:
        raise RuntimeError(f"Expected marker not found in {path}: {old[:120]!r}")
    target.write_text(source.replace(old, new, 1))


for path in [
    "tests/support-diagnostics-migration.test.ts",
    "tests/account-security-session-audit-migration.test.ts",
]:
    replace_once(
        path,
        'expect(applied.at(-1)).toBe("037_effective_access_snapshot.sql");',
        'expect(applied.at(-1)).toBe("038_canonical_session_scopes.sql");',
    )

replace_once(
    "src/lib/auth.ts",
    """  scopeDepartmentActive?: boolean;
  scopeDepartmentBranchId?: string;
  departmentAssignmentStatus?: string;
""",
    """  scopeDepartmentActive?: boolean;
  scopeDepartmentBranchId?: string;
  scopeDepartmentBranchActive?: boolean;
  departmentAssignmentStatus?: string;
""",
)
replace_once(
    "src/lib/auth.ts",
    """    scope_department.active AS \"scopeDepartmentActive\",
    scope_department.branch_id::text AS \"scopeDepartmentBranchId\",
    scope_department_assignment.status AS \"departmentAssignmentStatus\",
""",
    """    scope_department.active AS \"scopeDepartmentActive\",
    scope_department.branch_id::text AS \"scopeDepartmentBranchId\",
    scope_department_branch.active AS \"scopeDepartmentBranchActive\",
    scope_department_assignment.status AS \"departmentAssignmentStatus\",
""",
)
replace_once(
    "src/lib/auth.ts",
    """  LEFT JOIN departments scope_department
    ON scope_department.id=assignment.department_id
   AND scope_department.company_id=assignment.company_id
  LEFT JOIN department_assignments scope_department_assignment
""",
    """  LEFT JOIN departments scope_department
    ON scope_department.id=assignment.department_id
   AND scope_department.company_id=assignment.company_id
  LEFT JOIN branches scope_department_branch
    ON scope_department_branch.id=scope_department.branch_id
   AND scope_department_branch.company_id=scope_department.company_id
  LEFT JOIN department_assignments scope_department_assignment
""",
)
replace_once(
    "src/lib/auth.ts",
    """      && row.scopeDepartmentActive === true
      && row.departmentAssignmentStatus === \"ACTIVE\"
      && (!row.branchId || row.scopeDepartmentBranchId === row.branchId);
""",
    """      && row.scopeDepartmentActive === true
      && (!row.scopeDepartmentBranchId || row.scopeDepartmentBranchActive === true)
      && row.departmentAssignmentStatus === \"ACTIVE\"
      && (!row.branchId || row.scopeDepartmentBranchId === row.branchId);
""",
)
replace_once(
    "tests/canonical-session-scopes.test.ts",
    """      scopeDepartmentActive: true,
      scopeDepartmentBranchId: ids.branch,
      departmentAssignmentStatus: \"ACTIVE\",
""",
    """      scopeDepartmentActive: true,
      scopeDepartmentBranchId: ids.branch,
      scopeDepartmentBranchActive: true,
      departmentAssignmentStatus: \"ACTIVE\",
""",
)
replace_once(
    "tests/canonical-session-scopes.test.ts",
    """      candidate({ ...department, assignedRole: \"DEPARTMENT_ADMIN\", scopeDepartmentActive: false }),
      candidate({ ...department, assignedRole: \"DEPARTMENT_ADMIN\", scopeDepartmentBranchId: \"40000000-0000-4000-8000-000000000099\" }),
""",
    """      candidate({ ...department, assignedRole: \"DEPARTMENT_ADMIN\", scopeDepartmentActive: false }),
      candidate({ ...department, assignedRole: \"DEPARTMENT_ADMIN\", scopeDepartmentBranchActive: false }),
      candidate({ ...department, assignedRole: \"DEPARTMENT_ADMIN\", scopeDepartmentBranchId: \"40000000-0000-4000-8000-000000000099\" }),
""",
)
replace_once(
    "tests/canonical-session-scopes.test.ts",
    """      scopeDepartmentActive: true,
      scopeDepartmentBranchId: ids.branch,
      departmentAssignmentStatus: \"ACTIVE\",
    })])!;
""",
    """      scopeDepartmentActive: true,
      scopeDepartmentBranchId: ids.branch,
      scopeDepartmentBranchActive: true,
      departmentAssignmentStatus: \"ACTIVE\",
    })])!;
""",
)
