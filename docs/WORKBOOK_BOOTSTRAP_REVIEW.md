# Workbook review and first platform-owner bootstrap

These tools separate two bootstrap concerns that must not be combined:

- `validate_workbook.py` inventories an XLSX file and writes private review artifacts. It has no database client and cannot import production data.
- `create_first_platform_owner.mjs` creates only the first invited Axora
  platform owner and synchronously sends one HMAC-authenticated account-setup
  message. PostgreSQL stores only the token's SHA-256 hash; the raw token stays
  in process memory and is never printed. The command does not accept or
  generate a default password.

## Review an XLSX workbook

The validator uses only the Python standard library. The output directory is mandatory, caller-selected, and must not already exist.

```bash
npm run bootstrap:review-workbook -- \
  --workbook "/home/ashraf/Documents/Axora PDFs/Axora excelsheet database of products (version 1).xlsx" \
  --output-dir "/path/chosen/by/operator/axora-workbook-review"
```

Exit codes are:

- `0`: a complete, explicit schema was found and no blocking issue was detected. Rows still remain review-only candidates.
- `1`: the report was created, but import is blocked.
- `2`: the source, archive, bundled schema, or output location was unsafe or malformed.

The new output directory and `quarantine/` directory use mode `0700`; report and JSONL files use mode `0600`. The tool refuses symlinked inputs, existing output directories, ZIP traversal, encrypted entries, oversized parts, DTD/entity XML, macros, external workbook links, and external formulas.

Artifacts:

- `import-report.json` contains the source SHA-256, sheet/region inventory, formulas by digest and references, validations, tables, schema definitions, explicit normalization maps, issue locations, and a blocked/review-ready verdict.
- `quarantine/{companies,branches,products,recurring_products,account_roles}.jsonl` contains every extracted row. A row with no issues is marked `candidate`, never `imported`.

Credential-bearing headers or values are blocking. Their values are replaced with `[REDACTED_CREDENTIAL]` before any report, JSONL record, or row digest is written. Passwords, passcodes, recovery codes, private keys, API keys, bearer tokens, bcrypt/Argon2 verifiers, and similar material do not belong in a bootstrap workbook.

The schema contract is versioned in [`scripts/bootstrap/workbook_schemas.json`](../scripts/bootstrap/workbook_schemas.json). Missing values are never defaulted; free-text labels are never converted to stable foreign keys; ambiguous statuses and unknown roles are never guessed. Any accepted label-to-role conversion appears in both the schema map and the affected row's `normalizations` list. A workbook `PLATFORM_OWNER` row is always blocked.

### Current Axora planning workbook

For the workbook named above, SHA-256
`2b33d524557fcfa2112e2685a98faef2276f0fad129b200be82ed183620f6064`,
the validator currently produces a blocked report. It detects all six visible
sheets and quarantines 34 account-role-like rows, 7 branch rows (including
incomplete add-row placeholders), 57 catalog products, and 26 recurring-
product rows. No company master is present. Blocking findings include missing
stable company/product keys and required commercial fields, unknown or
incomplete role mappings, formula-supplied branch contact data, invalid status/
confirmation values, shifted validation domains, a catalog table beginning on
a data row, and summary formulas whose `Yes/No` criteria reference non-boolean
columns.

Do not turn the quarantine output into SQL. Resolve each issue in a reviewed source workbook or a separate, approved transformation design, rerun into a new output directory, and compare the deterministic reports.

## Create the first platform owner

Migration `021_platform_owner_setup_invitation.sql` and every later reviewed
migration in the sealed release must be applied by the normal migration
workflow. The current refactor-branch baseline ends at
`032_user_session_revocation_audit.sql`; it is a target baseline, not a claim
that production has been migrated. Migration `030` remains the minimum email
lifecycle/correlation schema; `031` adds only narrow support-summary and
support-audit capabilities while keeping direct audit-table writes unavailable
to the application role. Migration `032` adds a database-owned,
privacy-minimized audit boundary for session revocation without serializing
credential-adjacent session fields. The command verifies the complete local
migration manifest against `schema_migrations`, takes migration/bootstrap
advisory locks, and rechecks the owner state under a serializable transaction. It refuses to
run if any protected owner, active `PLATFORM_OWNER` assignment, or live owner
invitation exists in normal creation mode. The explicit
`--replace-pending-first-owner-invitation` recovery mode is limited to replacing
the single live invitation for the same still-pending first-owner identity.

Required environment:

- an explicit `DATABASE_URL`; implicit/local database targets are forbidden;
- `AXORA_EMAIL_SERVICE_AUTH_KEY_FILE`, pointing to the regular, non-symlink
  secret used to HMAC-authenticate the synchronous private sender request;
- `AXORA_EMAIL_DELIVERY_ENABLED=true` and the normal email-sender/provider
  configuration; the private `/health/ready` endpoint must report `ready`;
- optional `ACCOUNT_SETUP_TTL_HOURS` from 1 through 168 (default 24).

Run from a private operator shell. Shell history may retain argument text, so the reason should contain operational context but no secrets.

```bash
npm run bootstrap:first-platform-owner -- \
  --email owner@example.com \
  --display-name "Platform Owner" \
  --locale en \
  --operator "operator@example.com" \
  --reason "Approved initial Axora production bootstrap change CHG-1234" \
  --confirm-first-platform-owner
```

The only target-profile inputs are email, display name, and the account-email
locale (`en`, `ar`, or `ms`). Operator identity and reason are mandatory audit
evidence. The transaction creates:

- an active database row with application state `INVITED`, `is_owner=true`, company/branch `NULL`, and the rollback-safe pending-password sentinel;
- a profile, null normalized credential, platform-scoped `PLATFORM_OWNER` role assignment, and onboarding row;
- an account-setup invitation containing only the SHA-256 token hash and
  lifecycle/delivery metadata; no raw-token ciphertext or account-setup outbox
  row exists;
- immutable `platform_owner_bootstrap_audits` evidence linked to the user and invitation.

The command verifies sender readiness before opening the database transaction.
After commit it atomically claims the new invitation from `PENDING` to
`SENDING`, then makes one synchronous HMAC-authenticated request while the raw
token exists only in memory. The sender renders the account message with
Axora—not a fabricated tenant—as its brand context. The command prints only
record identifiers, expiry, and final delivery status. The recipient chooses
their password through the normal `/account/setup#token=...` flow; consumption
activates the user without creating a company membership.

There is no account-setup ciphertext, outbox poller, lease retry, or automatic
replay. A `FAILED` or `UNCERTAIN` first-owner result requires an explicit
replacement after the cause is reviewed. (Creation cannot produce `DISABLED`,
because bootstrap refuses before mutation unless delivery is enabled and the
sender is ready.) Run the same command with the exact pending owner's email and
display name, fresh operator/reason evidence, both confirmation flags, and the
same required environment:

```bash
npm run bootstrap:first-platform-owner -- \
  --email owner@example.com \
  --display-name "Platform Owner" \
  --locale en \
  --operator "operator@example.com" \
  --reason "Approved replacement after reviewed delivery failure CHG-1235" \
  --confirm-first-platform-owner \
  --replace-pending-first-owner-invitation
```

Recovery requires exactly one matching invited platform owner and exactly one
live, unconsumed invitation. In one serializable transaction it revokes that
invitation, creates a new invitation and hash, and appends new immutable
bootstrap audit evidence. The new token is then claimed and sent once. For an
`UNCERTAIN` provider result, reconcile the provider first; never use the flag
as a blind replay mechanism.

## Rollback boundary

Ordinary company invitations keep the composite tenant foreign key introduced in migration 014. Migration 021 only makes `company_id` nullable for the trigger-guarded owner case and adds a standalone user foreign key.

Application rollback can leave the new schema in place. A schema rollback must not restore `company_id NOT NULL` while a platform-owner invitation exists. Revoke and remove an unconsumed invitation/user only through a separately authorized, audited recovery procedure; preserve the immutable operator evidence externally; then remove the 021 triggers/table/standalone foreign key and restore the column constraint. There is intentionally no automatic destructive down migration.

No command in this document was run against production while implementing or testing these tools.
