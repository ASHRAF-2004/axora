# Product deletion recovery evidence

## Latest additional local-demo presentation observation — 2026-10-09 MY

Tested source123c9dc, NOT deployed. After its required host gates, fresh owned
standalone3153/public demo login created only product
`cb5cb79d-a3fa-4532-81fc-4598ca08e1f1`, “Isolated immediate-delete fixture 123c9dc”.
Its exact row/UUID links were verified, then one own UI Delete click was made;
next snapshot already showed Deleting product, so no separate confirmation
interaction is claimed. Before any refresh/navigation own row/detail links0
and total26→25; all25 original demo fixtures remained. Direct detail and refresh
both displayed404, root visually reviewed the capture (SHA422eb361…).
Owned browser/server closed/expected130; no real records/history were deleted.

This is volatile-DEMO immediate-render evidence only, NOT native database
cleanup/audit, production deletion, transport-loss/double-click or current03
before/after-restart acceptance. The original6B matrix and audit barrier below
remain open; no existing current03 product was replayed or deleted.

**Historical component investigation.** Current release and later actual
normal-auth isolated deletion/refusal evidence are in [FINAL_REPORT](FINAL_REPORT.md).
Pending native-gate wording below is superseded there; original exception and live
disposable production success are not retroactively proven. No real product/history
deletion was performed for acceptance.

## Existing exact-head concurrency and rollback evidence

The following native PostgreSQL cases passed in the recorded49-test exact0040
release gate. Their source is unchanged; this is not a new test run:

| Criterion | Actual test / boundary |
| --- | --- |
| Deletion wins a new cart-reference race | `tests/product-delete-native-postgres.test.ts:99` uses two connections and observed lock waits; deletion commits and the competing reference insert rejects23503/23001, leaving references0. Not every reference type or browser presentation. |
| Reference wins deletion race | Same file:118 commits the blocking cart reference; deletion returns CART and product/image remains. No claim of external cleanup-worker recovery. |
| Authority changes during lock wait | Same file:140 commits product.archive DENY during an observed authority lock wait; deletion uses current authority and returns FORBIDDEN/product remains. Not a live permission/SSE-revocation trial. |

Migrated PGlite runtime tests separately cover omitted cart-FK protection,
eligible deletion/sequential replay/history/audit and injected image-cleanup
rollback. Their DB adapter is mocked; they are not native races or injected
network-response loss. Earlier isolated browser deletion reloaded before list
absence and cannot prove immediate UI removal. Current-image before/after
restart and live disposable results must be read separately in FINAL_REPORT;
no real product/history deletion was authorized by merely signing in.

## Proven failure boundary

The original application guarded `request_lines` before deleting owned supplier
and image rows and then the product. In an isolated migrated database using the
deployment grants, a product with no request lines but an existing procurement
cart item reached the final DELETE and failed on
`procurement_cart_items_product_id_fkey`. PGlite reported SQLSTATE `23001`; the
implementation also handles PostgreSQL foreign-key SQLSTATE `23503`.
Transaction rollback preserved the product, image and cart reference.

The same original deletion path succeeded for an eligible isolated product.
An initial migration-only fixture lacked deployment DELETE grants and reported
`42501`; that was not the production root cause. Live read-only privilege checks
confirmed DELETE privileges on products, product images and product suppliers.

A sanitized live read-only aggregate found eleven products with no request-line
references, including one with a cart reference and none with a draft-only
reference. This supports the existence of the protected-reference boundary;
it does not identify the product or prove the original reported browser journey.
Retained historical logs did not provide the exact original deletion exception.
No live product was deleted or deactivated during diagnosis or validation.

## Scoped repair

Migration 138 exposes one audited Owner product-deletion capability and revokes
the application role's raw DELETE grants on `products`, `product_images` and
`product_suppliers`. The capability validates matching trusted audit context,
the live active and fully set-up Owner account, authentication version, canonical
active Platform Owner assignment, and both existing `product.manage` and
`product.archive` permissions with explicit DENY precedence.

Actor and assignment locks serialize with supported authority changes. The live
permission snapshot uses `clock_timestamp()` after acquiring those locks. Product
locking, existing restrictive foreign keys and transactional rollback preserve
the concurrent-reference boundary. Private checks cover purchase history,
procurement carts and integration drafts before removal; the application maps a
late foreign-key rejection to a safe protection result rather than a runtime
failure. Unauthorized callers receive no reference details.

Only product-owned supplier and database image rows are removed on successful
deletion. Shared assets and commercial/audit history remain intact. Already
absent products return idempotent success. The UI returns localized safe failure
messages and the existing deactivation alternative; it does not grant new
deactivation or deletion authority.

## Verification recorded for this component

- Focused Vitest files: twenty tests passed, including eligible deletion,
  duplicate/response-loss handling, restrictive references, asset rollback,
  live authorization failures and raw application-role DELETE denial.
- Canonical deployment grants were replayed twice in isolated migrated tests;
  they did not restore the three revoked raw DELETE privileges.
- Owned-file lint and `git diff --check` passed.
- Three native two-connection race tests were added for concurrent references
  and authority changes. Their execution is pending the integrated native
  PostgreSQL release gate; standard runs intentionally skip them without the
  explicitly isolated native test database.
- No production deletion acceptance or destructive catalog smoke is claimed.

## Rollback limitation

Migrations remain forward-only. A pre-138 application image remains otherwise
schema-compatible, but its legacy raw permanent-deletion queries are blocked
after migration 138. Image rollback is containment, not restoration of that old
deletion path. Do not restore raw DELETE grants or undo schema/data protections
to make an older image delete; use a reviewed forward fix.

## Final acceptance matrix — 2026-10-08 14:29:55 UTC checkpoint

This maps the six original Section6B acceptance bullets. Exact0040 native49
results remain valid for unchanged application source deployed as d82/bc8/139;
current03's created disposable product is not a deletion acceptance result.

| Original Section6B criterion | Proven evidence / environment | Not proved / remaining boundary |
| --- | --- | --- |
| Verified lifecycle authority deletes an eligible disposable product; list/detail are correct without manual refresh | Earlier normal-auth fenced a40 owned deletion/audit/refusals passed. Actual migrated PGlite `tests/product-delete-runtime.test.ts:124` verifies eligible deletion and owned assets/audit/history. Current03 created exactly one Owner-owned disposable product, with images1/suppliers0/history1/INSERT1/DELETE0 at its metadata projection. | Earlier browser list absence was checked AFTER reload, not immediate removal. Current03 deletion, immediate list detachment, detail/reload checks and after-restart journey have not executed. No eligible live product UUID, verified scope and per-action deletion/recovery approval are designated; signing in is insufficient authority. |
| Requests/orders/deliveries/financial or other protected history remains protected; no FK/cascade weakening | Migrated PGlite `tests/product-delete-runtime.test.ts:115` reproduces omitted cart-FK protection with rollback; :136 retains purchase-history products, :142 retains draft references and :243 retains assets under a restrictive FK. Native `tests/product-delete-native-postgres.test.ts:99`/:118 verifies both orderings of a cart-reference/deletion race. Existing restrictive foreign keys/history remain intact. | Native race coverage concerns cart references, not every historical relation. The unavailable original product/state/error is not reconstructed by the aggregate or isolated fixture; no real protected history was deleted. |
| Unauthorized roles, foreign targets and explicit DENY are rejected at server/database boundaries | Migrated PGlite runtime direct lifecycle/database cases at `tests/product-delete-runtime.test.ts:170`, :175, :188, :203, :215 and :228 cover role/DENY/raw-grant/context/assignment/identity boundaries. Native `tests/product-delete-native-postgres.test.ts:140` verifies a DENY committed during an authority lock wait. Earlier isolated normal Company Admin denial is recorded separately. | The PGlite DB adapter is mocked but executes actual migrated SQL; it is not a live destructive denial trial. No current03 Company Admin denial tail, live role change or SSE-revocation claim follows from the guard stop. Real destructive negative tests remain prohibited. |
| Repeated/already-deleted actions, response loss and concurrent reference creation remain consistent | Migrated PGlite `tests/product-delete-runtime.test.ts:124` repeats actual deletion and verifies one DELETE audit, retained history and unrelated product assets. Native :99 rejects a reference inserted behind committed deletion with23503/23001 and references0; :118 retains a committed blocking reference/images; :140 retains product under a newly committed DENY. | PGlite repeated invocation is sequential replay, not injected network-response loss or a browser double-click. Native tests observe genuine two-connection lock waits, not every reference type or current03 browser workflow. |
| Database/asset-cleanup failures cannot falsely succeed, lose business data or remove shared assets; deferred work is recoverable | Migrated PGlite `tests/product-delete-runtime.test.ts:156` injects image-cleanup failure and verifies product/images/supplier links rollback; :124 keeps unrelated product assets and audit/commercial history. Current capability removes only database-owned image and supplier-link rows transactionally; no new deferred cleanup pipeline is introduced. | No external/shared-file cleanup worker restart is demonstrated by these tests. Current03 deletion/atomic asset/audit checks remain unexecuted; no current-image post-restart product result is inferred. |
| Focused original-exception regression and same deployed journey before/after bounded restart are evidenced separately from live | The diagnosed cart-FK runtime boundary and correction have focused migrated tests plus exact0040 native/release gates. Earlier a40 isolated browser deletion is distinct from current03 d82 creation and live evidence. | The original reported exception remains unavailable. Current03 stopped before deletion/restart at the integrity barrier below; no same deployed-image before/after lifecycle proof exists. Trial2 is being prepared separately and must not be counted before its actual result. The live destructive scenario remains untested without its exact fixture/action approval. |

### Current03 existing fixture and integrity barrier

The exact owned product `a23bed0b-656c-4d50-a9e7-f39bd63f300a`, label
`ISOLATED D82 DELETE BEFORE-RESTART 3093e241-0f2f-4d9c-9de5-f655ad8e2449`,
was created ONCE in continuation03 after14:12:16.160Z. Its original creation
marker and evidence remain intact; DELETE0 is not deletion success. It must not
be recreated, reset or passed through the consumed original creation phase.
The same pending-setup SENT invitation remains untaken; new parent04 source
has not executed, and no after-trial workflow proof exists.

At14:29:55Z the strict guard preflight reached original-row and audit-graph
checks, then failed `canonical_temporal_discrepancy_changed` before any new
authentication, deletion, restart or setup attempt. Baseline audit events/
temporal-invalid results2326/21 became2383/23. All21 original invalid results
are unchanged, newly invalid original events0; the two additional invalid
results concern new canonical read VIEW audits with17 microseconds of inverted
timestamp ordering. Graph/hash errors0 do not override the temporal failure.
No audit history was rewritten and no guard was weakened. This is not a
whole-flow integrity pass or proof of the missing original product exception.

Private strict-preflight and temporal-diagnostic evidence SHA256:
`be999e827f9eab5adca7127d3bb176e31ce115cf00fc5f4fbf5728b3510195db`;
`09a2d6235c2bb5decd5e1216d7e8dbafa0239d54086c760869e8e4eaa75e5eb9`.
The remaining trial2 probe is separate preparation, not a passed restart.
FINAL_REPORT owns the overall verdict and later actual results. Conditional
Slack/migration inputs are not core blockers; missing exact live product/action
authority and the isolated integrity/restart boundary remain explicitly open.
