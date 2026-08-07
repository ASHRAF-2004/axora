from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one match, found {count}")
    return text.replace(old, new, 1)


support_path = Path("tests/support-diagnostics-migration.test.ts")
support = support_path.read_text()
support_anchor = """    FROM roles WHERE role_key='COMPANY_ADMIN';

    INSERT INTO role_assignments(user_id,role_id,scope_type)"""
support_replacement = """    FROM roles WHERE role_key='COMPANY_ADMIN';

    INSERT INTO company_memberships(
      user_id,company_id,status,is_primary,joined_at,created_by
    ) VALUES (
      '${ids.target}','${ids.company}','ACTIVE',true,now(),'${ids.owner}'
    );

    INSERT INTO role_assignments(user_id,role_id,scope_type)"""
support_path.write_text(replace_once(
    support,
    support_anchor,
    support_replacement,
    "support target company membership",
))

lifecycle_path = Path("tests/role-scope-lifecycle-migration.test.ts")
lifecycle = lifecycle_path.read_text()
ledger_anchor = """      await db.exec("CREATE ROLE axora_app NOLOGIN");
      const source = await applyApplicationGrantScript(db);"""
ledger_replacement = """      await db.exec("CREATE ROLE axora_app NOLOGIN");
      await db.exec(`CREATE TABLE schema_migrations(
        filename text PRIMARY KEY,sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const source = await applyApplicationGrantScript(db);"""
lifecycle_path.write_text(replace_once(
    lifecycle,
    ledger_anchor,
    ledger_replacement,
    "role lifecycle grant test migration ledger",
))
