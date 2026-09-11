# Axora Technical Handover Index

**Evidence baseline:** `main` at commit `49ccf0e3413504e1f5a753b491dc1770533a6e80` (inspected 11 September 2026).  
**Purpose:** enable another developer to continue Axora without treating the current MVP as immutable final architecture.

## How to use this handover

Read this package in order. The documents distinguish three things deliberately:

1. **Current MVP**: repository-backed behavior that exists at the evidence commit.
2. **Target requirements**: business and software requirements that should survive architecture evolution.
3. **Recommendations**: proposed next steps that still require technical or business approval.

Do not infer production state from repository state alone. The repository contains both runtime code and preparation/transition documentation. Where production cutover, external provider configuration, off-machine recovery, or other operational gates are not proven by repository evidence, this package marks them as a verification item rather than claiming completion.

## Handover map

| Document | Purpose |
|---|---|
| `01_PRODUCT_AND_BUSINESS_REQUIREMENTS.md` | Business outcomes and non-negotiable product rules |
| `02_CURRENT_MVP_SYSTEM_INVENTORY.md` | What the repository currently implements |
| `03_TARGET_AXORA_REQUIREMENTS.md` | Recommended future-system requirements |
| `04_REBUILD_DISPOSITION_MATRIX.md` | Preserve / Rebuild / Remove / Defer / Business Decision Required |
| `05_ROLES_PERMISSIONS_AND_SCOPE.md` | Authorization model and scope boundaries |
| `06_WORKFLOWS_AND_STATE_MACHINES.md` | Procurement, payment, delivery and account flows |
| `07_DATA_MODEL_AND_DATA_DICTIONARY.md` | Domain entities, ownership, evidence and migration source of truth |
| `08_API_AND_INTEGRATION_CONTRACTS.md` | Web/API boundaries and external integrations |
| `09_SECURITY_AND_NON_FUNCTIONAL_REQUIREMENTS.md` | Security, reliability, privacy and maintainability requirements |
| `10_DEPLOYMENT_AND_OPERATIONS_HANDOVER.md` | Deployment, backups, recovery and operational checks |
| `11_TESTING_AND_ACCEPTANCE_CRITERIA.md` | Verification gates and acceptance criteria |
| `12_TECHNICAL_DEBT_AND_KNOWN_PROBLEMS.md` | Known risks, stale docs and debt |
| `13_DECISIONS_REQUIRED.md` | Decisions that should not be guessed by the next developer |
| `14_CURRENT_TO_TARGET_TRACEABILITY.md` | Requirement-to-current-evidence map |
| `15_FUTURE_DEVELOPMENT_ROADMAP.md` | Phased development roadmap |
| `adr/` | Architecture Decision Records for major handover decisions |

## Primary repository sources

- `README.md`
- `src/lib/permissions.ts`
- `src/lib/types.ts`
- `src/lib/workflow.ts`
- `database/migrations/`
- `tests/full-migration-chain.test.ts`
- `.github/workflows/ci.yml`
- `PAYMENT_AND_INVOICE_OPERATING_RULES.md`
- `docs/MVP_OPERATING_MODEL.md`
- `docs/PRODUCTION_ARCHITECTURE.md`
- `docs/PRODUCTION_RUNBOOK.md`
- `docs/DISASTER_RECOVERY.md`
- `docs/driver-live-operations.md`
- `docs/refactor/ARCHITECTURE.md`
- `docs/refactor/ROLE_MATRIX.md`
- `docs/refactor/SECURITY_BASELINE.md`

## Evidence discipline

The current repository contains 136 numbered forward migrations at the inspected commit, and the complete migration-chain test explicitly verifies migration ordering, uniqueness, and a broad set of schema/policy invariants. Use the migration files and tests as the authoritative implementation history rather than old screenshots or prose alone.

When a document in the repository disagrees with current code, prefer executable sources and newer migrations/tests, then update the prose document as part of the same reviewed change.
