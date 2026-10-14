# Rebuild Disposition Matrix

This matrix is a handover recommendation, not an instruction to rewrite the system immediately.

| Capability | Disposition | Reason |
|---|---|---|
| Company onboarding/activation contract | **Preserve** | Core validated business workflow and audit boundary |
| Canonical request/order workspace | **Preserve** | Reduces duplicated order paths and gives one lifecycle record |
| Server-side role/scope authorization | **Preserve** | Security invariant; implementation can be refactored but semantics must remain |
| Separation of requester and approver | **Preserve** | Required separation of duties |
| Branch/company budget ownership | **Preserve** | Business boundary confirmed in current MVP |
| Provider-neutral payment completion boundary | **Preserve** | Allows future gateway replacement without rewriting downstream flows |
| Current testing-stage payment adapter | **Rebuild** | Pilot mechanism should be replaced by an approved operational method/provider |
| Current UI page composition | **Rebuild selectively** | Preserve validated workflows, improve maintainability and clarity where pages carry historical complexity |
| Legacy role compatibility paths | **Remove later** | Keep during migration only; retire after active data and integrations are fully canonical |
| Retired supplier-facing/customer-unneeded surfaces | **Remove / keep historical data only** | Current MVP deliberately simplified supplier-facing behavior |
| Public/visitor auxiliary features not needed for pilot | **Defer** | Avoid scope expansion before core procurement is stable |
| Broad workflow automation | **Defer / stage** | Automate only after rules are stable and exceptions understood |
| Delivery self-claim and receiving separation | **Preserve** | Strong operational and accountability model |
| General-availability mapping/routing | **Business Decision Required** | Provider, coverage, cost and privacy need approval |
| Delivery fee accounting treatment | **Business Decision Required** | Finance policy, not a developer assumption |
| Retention policy beyond controlled pilot | **Business Decision Required** | Legal/operational policy needed |
| Existing migration history | **Preserve** | Immutable historical contract; use forward migrations |
| Current deployment controller design | **Preserve principles, review implementation** | Exact commit, immutable image, backup-before-migrate and rollback are good invariants; infrastructure may evolve |
| Older/stale documentation | **Rebuild/update** | Several documents describe earlier migration/route models and should not be treated as live truth |

## Automation maturity classification

### Keep manual during the next pilot

- final approval of company activation where business judgment is needed;
- exceptional finance/reconciliation decisions;
- destructive recovery/reset approval;
- high-risk permission/owner changes;
- external-provider credential/DNS enablement.

### Suitable for partial automation

- invitation sending and retry-safe status tracking;
- budget refresh/reconciliation checks;
- invoice/document generation;
- deployment preflight and post-deploy health checks;
- delivery status notifications.

### Ready for full automation when prerequisites are satisfied

- deterministic CI quality gates;
- immutable image build/publish;
- routine health checks;
- safe idempotent workflow notifications;
- scheduled verified backups with off-machine copy once destination/escrow is approved.

### Automate later after business rules stabilize

- complex sourcing decisions;
- payment settlement exceptions;
- broad procurement recommendation/auto-approval logic;
- retention/purge beyond pilot policy;
- dynamic routing/ETA decisions that introduce a new provider/cost/privacy model.
