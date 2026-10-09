# Future Development Roadmap

## Phase 0 - Handover and evidence stabilization

- Review this handover package with the receiving developer.
- Confirm current production/runtime state separately from repository state.
- Record current release commit, migration state and external dependencies.
- Close obvious documentation drift.

## Phase 1 - Pilot hardening

Focus on proven workflows rather than feature growth:

- company setup and access;
- catalogue/request/approval/direct-purchase behavior;
- budget/wallet clarity;
- payment/invoice evidence;
- delivery claim/tracking/receiving;
- retry/recovery behavior;
- negative authorization tests;
- backup/restore evidence.

Keep business judgment and high-risk actions manual during this phase.

## Phase 2 - Architecture cleanup

- Retire legacy role/status compatibility where data evidence permits.
- Consolidate duplicated policy/service logic.
- Refresh route/architecture/security docs to the current migration state.
- Improve module boundaries without changing validated business semantics.
- Define a clean baseline/bootstrap path for new environments without rewriting production migration history.

## Phase 3 - Production integrations

Only after business approval:

- implement/enable the production payment adapter;
- complete external provider/DNS/Tunnel verification;
- choose map/routing coverage/provider if required;
- enable prioritized Slack/Zapier/integration use cases;
- prove off-machine backup and recovery.

## Phase 4 - Controlled automation

Automate deterministic work first:

- deployment and health evidence;
- invoice/document generation;
- notification/retry flows;
- scheduled backup verification;
- deterministic reconciliation checks.

Defer business-judgment automation until rules and exception handling are mature.

## Phase 5 - Broader rollout

Before wider customer adoption:

- close high-risk security decisions such as stronger owner authentication;
- confirm retention/privacy policy;
- run broader UAT and operational drills;
- review observability/support process;
- document support ownership and escalation.

## Roadmap rule

Every phase should have explicit acceptance criteria and a rollback/migration strategy. Do not carry a temporary MVP implementation choice forward only because it already exists.
