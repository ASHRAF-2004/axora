from pathlib import Path

for name in (
    "tests/support-diagnostics-migration.test.ts",
    "tests/account-security-session-audit-migration.test.ts",
):
    path = Path(name)
    source = path.read_text()
    old = 'expect(applied.at(-1)).toBe("047_isolation_closure_capabilities.sql");'
    new = 'expect(applied.at(-1)).toBe("049_active_request_write_boundary.sql");'
    if new in source:
        continue
    if source.count(old) != 1:
        raise RuntimeError(
            f"Expected one final-migration assertion in {name}, found {source.count(old)}"
        )
    path.write_text(source.replace(old, new, 1))
