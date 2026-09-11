# Technical Debt and Known Problems

## Documentation drift

Some repository documents describe earlier states and migration ceilings. For example, older architecture/security documents were written when production or refactor evidence stopped around migrations 013-032, while the current migration-chain test reaches 136. Treat those documents as historical context and refresh them when they are relied on operationally.

The `.superdesign/init/routes.md` route map also reflects an older portal composition and should not be used alone to decide which surfaces are currently active after MVP simplification.

## Compatibility debt

Legacy role/status compatibility remains in the codebase to support migration/history. It is useful during transition but increases policy complexity. Plan a measured retirement only after active data and integrations use canonical assignments/states.

## Policy duplication risk

Authorization rules exist across permission helpers, service/repository logic, migrations/capabilities and tests. This defense-in-depth is intentional, but duplicated business policy can drift. Keep one named business contract and verify each layer against it.

## Large migration history

The forward migration history is long. Do not squash or rewrite it casually. Future maintainability may benefit from a documented baseline/bootstrap strategy for brand-new environments, but production history must remain verifiable.

## External operational evidence

Repository code cannot prove current DNS/Tunnel/provider/off-machine-backup state. External runbook checks need human/runtime evidence.

## Payment maturity

The current payment completion strategy is appropriate for testing/pilot semantics but not a substitute for an approved production settlement provider/process. The boundary is intentionally replaceable.

## Security follow-up

Revalidate phishing-resistant owner authentication, off-machine recovery, historical-table RLS coverage, malware scanning policy and external edge/provider configuration before broad rollout.

## UI and workflow simplification

Axora has undergone several simplification passes. Before adding new screens or roles, check whether the requirement can fit the canonical request/company/user/delivery workspaces. Avoid recreating retired parallel flows.
