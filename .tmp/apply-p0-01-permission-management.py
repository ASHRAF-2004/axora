from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    source = target.read_text()
    if old not in source:
        raise RuntimeError(f"Expected marker not found in {path}: {old[:120]!r}")
    target.write_text(source.replace(old, new, 1))


# Keep the removal query strongly typed without relying on composite-target
# expansion plus a trailing scalar, which is not portable across PostgreSQL
# compatibility engines.
replace_once(
    "database/migrations/039_scoped_permission_management.sql",
    """  actor_snapshot jsonb;
  existing_row public.user_permission_overrides%ROWTYPE;
  permission_code text;
  invalidation record;
""",
    """  actor_snapshot jsonb;
  existing_row public.user_permission_overrides%ROWTYPE;
  invalidation record;
""",
)
replace_once(
    "database/migrations/039_scoped_permission_management.sql",
    """  SELECT override_row.*,permission.permission_code
  INTO existing_row,permission_code
  FROM public.user_permission_overrides override_row
  JOIN public.permissions permission ON permission.id=override_row.permission_id
  WHERE override_row.id=p_override_id
  FOR UPDATE OF override_row;
""",
    """  SELECT override_row.*
  INTO existing_row
  FROM public.user_permission_overrides override_row
  WHERE override_row.id=p_override_id
  FOR UPDATE;
""",
)

# Baseline-reset grant reapplication must preserve the same authorization
# boundary installed by migrations 036-039.
replace_once(
    "database/admin/apply-app-grants.sql",
    """  public.public_visitor_counter_state,
  public.public_visitor_claims,
  public.public_visitor_claim_tokens
FROM axora_app;
""",
    """  public.public_visitor_counter_state,
  public.public_visitor_claims,
  public.public_visitor_claim_tokens,
  public.permissions,
  public.role_permissions,
  public.departments,
  public.department_assignments,
  public.user_scopes,
  public.user_permission_overrides,
  public.approval_limits,
  public.delegated_access,
  public.delegated_access_permissions,
  public.delegated_access_scopes,
  public.permission_change_history
FROM axora_app;

GRANT SELECT ON TABLE public.permissions,public.role_permissions
TO axora_app;
""",
)
replace_once(
    "database/admin/apply-app-grants.sql",
    """  public.axora_claim_public_visitor(
    text,text,text,text,text,text,text,timestamptz,text
  )
FROM axora_app;
""",
    """  public.axora_claim_public_visitor(
    text,text,text,text,text,text,text,timestamptz,text
  ),
  public.axora_effective_access_snapshot(uuid,uuid,timestamptz),
  public.axora_authorization_scope_contains(
    text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid
  ),
  public.axora_scope_contains_nullable(
    text,uuid,uuid,uuid,uuid,text,uuid,uuid,uuid,uuid
  ),
  public.axora_snapshot_scope_contains(jsonb,text,uuid,uuid,uuid,uuid),
  public.axora_snapshot_has_permission(jsonb,text,text,uuid,uuid,uuid,uuid),
  public.axora_invalidate_authorization_sessions(uuid,uuid,text),
  public.axora_set_user_permission_override(
    uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,
    timestamptz,timestamptz,text
  ),
  public.axora_remove_user_permission_override(uuid,uuid,uuid,text)
FROM axora_app;
""",
)
replace_once(
    "database/admin/apply-app-grants.sql",
    """  public.axora_claim_public_visitor(
    text,text,text,text,text,text,text,timestamptz,text
  )
TO axora_app;
""",
    """  public.axora_claim_public_visitor(
    text,text,text,text,text,text,text,timestamptz,text
  ),
  public.axora_effective_access_snapshot(uuid,uuid,timestamptz),
  public.axora_set_user_permission_override(
    uuid,uuid,uuid,uuid,text,text,text,uuid,uuid,uuid,uuid,
    timestamptz,timestamptz,text
  ),
  public.axora_remove_user_permission_override(uuid,uuid,uuid,text)
TO axora_app;
""",
)

# The forward migration ledger and tests must treat 039 as the current tip.
replace_once(
    "tests/full-migration-chain.test.ts",
    'it("applies every numbered migration through 038 to an empty database", async () => {',
    'it("applies every numbered migration through 039 to an empty database", async () => {',
)
replace_once(
    "tests/full-migration-chain.test.ts",
    """      expect(available.slice(-5)).toEqual([
        \"034_public_visitor_network_fallback.sql\",
        \"035_public_visitor_network_uniqueness.sql\",
        \"036_authorization_policy_foundation.sql\",
        \"037_effective_access_snapshot.sql\",
        \"038_canonical_session_scopes.sql\",
      ]);
""",
    """      expect(available.slice(-5)).toEqual([
        \"035_public_visitor_network_uniqueness.sql\",
        \"036_authorization_policy_foundation.sql\",
        \"037_effective_access_snapshot.sql\",
        \"038_canonical_session_scopes.sql\",
        \"039_scoped_permission_management.sql\",
      ]);
""",
)
replace_once(
    "tests/full-migration-chain.test.ts",
    """      await db.exec(await readFile(
        migrationUrl(\"038_canonical_session_scopes.sql\"),
        \"utf8\",
      ));

      const after = await db.query<{
""",
    """      await db.exec(await readFile(
        migrationUrl(\"038_canonical_session_scopes.sql\"),
        \"utf8\",
      ));
      await db.exec(await readFile(
        migrationUrl(\"039_scoped_permission_management.sql\"),
        \"utf8\",
      ));

      const after = await db.query<{
""",
)
replace_once(
    "tests/full-migration-chain.test.ts",
    'it("keeps reset migration discovery dynamic through 038 while bootstrap retains its 032 minimum", async () => {',
    'it("keeps reset migration discovery dynamic through 039 while bootstrap retains its 032 minimum", async () => {',
)
replace_once(
    "tests/full-migration-chain.test.ts",
    """|037_effective|038_canonical/);
    expect(reset).not.toMatch(/024_canonical|025_customer|026_workflow|027_receipt|028_email|029_delivery|030_email|031_support|032_user|033_public|034_public|035_public|036_authorization|037_effective|038_canonical/);
""",
    """|037_effective|038_canonical|039_scoped/);
    expect(reset).not.toMatch(/024_canonical|025_customer|026_workflow|027_receipt|028_email|029_delivery|030_email|031_support|032_user|033_public|034_public|035_public|036_authorization|037_effective|038_canonical|039_scoped/);
""",
)
for path in [
    "tests/support-diagnostics-migration.test.ts",
    "tests/account-security-session-audit-migration.test.ts",
]:
    replace_once(
        path,
        'expect(applied.at(-1)).toBe("038_canonical_session_scopes.sql");',
        'expect(applied.at(-1)).toBe("039_scoped_permission_management.sql");',
    )
