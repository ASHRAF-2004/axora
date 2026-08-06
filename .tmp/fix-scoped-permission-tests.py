from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text()
    if old not in source:
        raise RuntimeError(f"Expected marker not found in {path}: {old[:120]!r}")
    target.write_text(source.replace(old, new, 1))


path = "tests/scoped-permission-management-migration.test.ts"
replace_once(
    path,
    """  secondOwnerAssignment: \"b4000000-0000-4000-8000-000000000039\",
};
""",
    """  secondOwnerAssignment: \"b4000000-0000-4000-8000-000000000039\",
  secondCompany: \"c1000000-0000-4000-8000-000000000039\",
  secondBranch: \"c2000000-0000-4000-8000-000000000039\",
};
""",
)
replace_once(
    path,
    """    secondCompanyId: string;
    secondBranchId: string;
    companyAdminRoleId: string;
""",
    """    companyAdminRoleId: string;
""",
)
replace_once(
    path,
    """      second_company.id::text AS \"secondCompanyId\",
      second_branch.id::text AS \"secondBranchId\",
      (SELECT id::text FROM roles WHERE role_key='COMPANY_ADMIN')
""",
    """      (SELECT id::text FROM roles WHERE role_key='COMPANY_ADMIN')
""",
)
replace_once(
    path,
    """    FROM companies first_company
    JOIN branches first_branch ON first_branch.company_id=first_company.id
    JOIN companies second_company ON second_company.id<>first_company.id
    JOIN branches second_branch ON second_branch.company_id=second_company.id
    JOIN users owner ON owner.is_owner AND owner.active
    JOIN role_assignments owner_assignment
      ON owner_assignment.user_id=owner.id AND owner_assignment.active
    ORDER BY first_company.id,first_branch.id,second_company.id,second_branch.id
    LIMIT 1
  `);
  const value = context.rows[0];

  await db.query(`
""",
    """    FROM companies first_company
    JOIN branches first_branch ON first_branch.company_id=first_company.id
    JOIN users owner ON owner.is_owner AND owner.active
    JOIN role_assignments owner_assignment
      ON owner_assignment.user_id=owner.id AND owner_assignment.active
    ORDER BY first_company.id,first_branch.id
    LIMIT 1
  `);
  const value = {
    ...context.rows[0],
    secondCompanyId: ids.secondCompany,
    secondBranchId: ids.secondBranch,
  };
  if (!value.companyId) throw new Error(\"Permission fixture company is unavailable\");

  await db.query(`
    INSERT INTO companies(id,company_code,name,active)
    VALUES ($1,'C-PERM-039','Permission test company two',true)
  `, [value.secondCompanyId]);
  await db.query(`
    INSERT INTO branches(
      id,branch_code_id,company_id,name,branch_code,delivery_address,active
    ) VALUES (
      $1,'B-PERM-039',$2,'Permission branch two','PERM-039',
      'Permission fixture address',true
    )
  `, [value.secondBranchId,value.secondCompanyId]);

  await db.query(`
""",
)
replace_once(
    path,
    """      await db.exec(\"CREATE ROLE axora_app NOLOGIN\");
      await applyMigrations(db);
      await applyApplicationGrantScript(db);
""",
    """      await db.exec(\"CREATE ROLE axora_app NOLOGIN\");
      await applyMigrations(db);
      await db.exec(`CREATE TABLE schema_migrations(
        filename text PRIMARY KEY,sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      await applyApplicationGrantScript(db);
""",
)
