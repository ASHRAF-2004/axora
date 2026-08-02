# Bootstrap tooling

- `validate_workbook.py`: standard-library XLSX inventory and quarantine only; it cannot import.
- `workbook_schemas.json`: explicit versioned company, branch, product, recurring-product, and account-role contracts.
- `create_first_platform_owner.mjs`: one-time, audited `INVITED` owner creation
  with hash-only invitation persistence and one HMAC-authenticated synchronous
  send. It refuses before mutation unless the sender is enabled and ready.
  `--replace-pending-first-owner-invitation` is the explicit recovery path for
  the same pending first owner; it revokes the old invitation and issues a new
  token rather than retrying it.

See [`docs/WORKBOOK_BOOTSTRAP_REVIEW.md`](../../docs/WORKBOOK_BOOTSTRAP_REVIEW.md) for commands, exit codes, security properties, and rollback limits.
