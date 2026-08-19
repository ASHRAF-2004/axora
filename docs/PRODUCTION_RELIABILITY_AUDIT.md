# Prompt 5.1 — Production Reliability and Error-Recovery Audit

## Scope and immutable baseline

- Repository: `ASHRAF-2004/axora`
- Audited protected base: `2d679ee762ae10dc0ee9bdb8cdb7028de6f0a8d7`
- Base commit: `feat(users): complete existing-user access management (#138)`
- Parent: `e70638a6625296f43d4705665880ff7fa690cfea`
- Locked Next.js release: `16.2.11`
- This audit does **not** deploy, run production migrations, alter production data, change secrets, enable the deployment timer, or modify Cloudflare/Resend/Caddy runtime configuration.

## Incident status

A production acceptance test reported this user-visible sequence after Prompt 5:

1. a valid People & Access profile/access operation was submitted once;
2. the portal generic recovery boundary was displayed;
3. the same class of operation succeeded after a later retry.

A captured production People & Access page immediately before the reported incident proves that the Prompt 5 Delivery account management UI was being served. The available evidence does **not** contain the matching application exception, framework digest, SQLSTATE, HTTP response, Server Action identifier, or request correlation record for the failed first attempt.

Therefore this audit deliberately does **not** label one speculative mechanism as the incident root cause. In particular, stale deployment state, framework control-flow handling, database failure, and transport failure are not interchangeable explanations.

The repository does prove multiple independent reliability defects that made the incident hard to diagnose and made similar first-attempt failures possible:

- the portal boundary ignored its framework digest and misleadingly blamed connectivity for unrelated failures;
- the self-hosted Next.js build had no deployment identity, even though production replaces the active application revision;
- Prompt 5 role/scope replacement used a broad catch plus a `digest`-property heuristic to recognize framework redirect control flow;
- several older mutation surfaces still rely on native/client validation in front of direct server-side schema parsing, so a stale/tampered request can be contained only by the route boundary unless the action has its own local error contract.

Historical production evidence also contains an unrelated expected permission-selection failure (`digest 3651452337`) that reached the server error path. It is useful evidence for the generic-boundary observability problem, but it is **not** the Prompt 5.1 incident and must not be presented as such.

## Error-surface inventory

Twenty significant reliability surfaces were reviewed. The classification letters follow Prompt 5.1:

- **A** — expected validation/business failure
- **B** — authentication failure
- **C** — authorization failure
- **D** — network/offline failure
- **E** — stale client/deployment/version failure
- **F** — unexpected server failure
- **G** — unexpected client/render failure
- **H** — intentional not-found
- **I** — other

| # | Surface | Classes | Audit result |
|---:|---|---|---|
| 1 | `src/app/(portal)/error.tsx` | D/F/G | Boundary is required, but old copy conflated every failure with connectivity and exposed no safe reference. Fixed to distinguish actual offline state, retain unexpected-fault containment, and render only a sanitized digest reference. |
| 2 | Authentication/session loaders (`requirePermission`, page guards, lifecycle session) | B/C | Authentication and permission checks remain server-authoritative. No error-handling change weakens them. |
| 3 | Resource `notFound()` paths | H | Intentional absence remains separate from unexpected failure. No blanket catch is introduced around framework navigation control flow. |
| 4 | Prompt 5 existing-user access actions | A/C/F | Expected mutation failures already return to the management workspace. The role/scope action's redirect/digest catch heuristic was brittle and is removed. Revalidation/navigation now occur after the caught mutation. |
| 5 | Create User / Delivery Guy invitation | A/C/F | Creation is transactional; invitation delivery occurs after creation. Existing duplicate/role/scope controls remain. Prior Delivery Guy PostgreSQL typing regression is already covered separately and was not reintroduced. |
| 6 | Self-profile actions | A/B/C/F | Established local validation pattern returns `invalid-profile`; redirect happens after validation/mutation. Used for the reusable first-attempt browser regression. |
| 7 | Approval actions | A/C/F | Known validation/domain failures are mapped to local notices/results. Approval commands retain idempotency/concurrency controls. |
| 8 | Operations approval action state | A/C/F | Uses typed action state and local feedback. Audit notes that raw `console.error(error)` remains an older logging style and should not be copied into new reliability code. |
| 9 | Budget actions | A/C/F | Main budget mutations map known failures locally and period commands use command identities. No blanket retry is added. |
| 10 | Branch budget action | A/C/F | Server schema parsing remains strict. Ordinary browser constraints prevent common invalid input, but stale/tampered requests can still reach a schema exception; recorded as remaining hardening debt rather than hidden by the global boundary. |
| 11 | Organization structure actions | A/C/F | Strong schemas and server authorization are present. Direct parse failures are remaining local-feedback debt. |
| 12 | Request creation/status/payment | A/C/F | Request form has detailed local validation; request creation carries a client submission UUID and persistence uses existing idempotency semantics. Server schema errors still remain strict. No unsafe automatic replay is introduced. |
| 13 | Delivery driver actions | A/C/D/F | Existing action wrapper maps known delivery errors to controlled outcomes and existing transition/idempotency rules remain authoritative. |
| 14 | Settings actions | A/C/F | Authorization and strict validation remain; some direct parse failures are remaining local-feedback debt. |
| 15 | Company/master lifecycle actions | A/C/F | Company, branch, invitation, product, and lifecycle operations were reviewed. Product actions already use typed action state; several older company/branch form actions use direct parse and are recorded as hardening debt. |
| 16 | Company onboarding actions | A/C/F | Optimistic version checks and authorization remain; direct schema parsing is a remaining local-feedback hardening item. |
| 17 | Company theme/branding actions | A/C/F | File absence already redirects locally; several schema parses remain strict. Theme transition service returns controlled business statuses. |
| 18 | Profile-avatar API | A/B/C/D/F | Already returns typed HTTP JSON errors, a request reference, private/no-store responses, and avoids raw error rendering. Unexpected server logs do not include raw exception text. |
| 19 | Next.js build/deployment identity | E | Production build previously had no `deploymentId`; stale browser/new release skew was structurally possible. Fixed by stamping the exact immutable revision at build time. |
| 20 | Caddy/reverse proxy/cache path | D/E/F | Repository production Caddy configuration reverse-proxies the app and does not define HTML/RSC/Server Action response caching. No Caddy change is justified. |

## Prompt 5 transaction and first-request-state audit

The administrator-managed profile mutation was inspected specifically for a "first call initializes state" failure mode.

`updateManagedUserProfile` reauthorizes the actor/target and performs the profile and identity updates inside the existing database transaction. It requires the expected profile/user rows to be updated and records the audit event in the same transactional operation. No `ensureProfile`, create-if-missing, or successful partial initialization was found in that path. A failed transaction is therefore not intentionally used as a warm-up for the second attempt.

Prompt 5 role/scope replacement remains database-authoritative and atomic through migration 101. This audit does not edit migration 101.

## Framework control-flow audit

Next.js navigation helpers intentionally use framework control flow. The Prompt 5 role/scope action previously executed `redirect()` inside a broad `try` and then attempted to recognize the framework error by checking whether the caught object merely had a `digest` property.

The fix makes the ordering explicit:

1. execute only the application mutation inside the catchable region;
2. store the successful result;
3. revalidate after mutation success;
4. call `redirect()` outside that catch.

No exception-message/digest heuristic is required.

Other reviewed actions with redirects generally already redirect after the mutation or use established local action-state patterns.

## Deployment/version-skew audit

### Before this change

- `next.config.ts` did not define a deployment ID.
- the Docker builder did not receive `AXORA_REVISION` before `npm run build`;
- production deployment builds an immutable exact-main revision and replaces the active application service;
- a browser can remain open across that replacement.

That combination leaves Axora structurally exposed to old-client/new-server Next.js version skew.

### After this change

The Docker builder receives the exact Git revision and sets:

```text
NEXT_DEPLOYMENT_ID=${AXORA_REVISION}
```

before `npm run build`. The runner receives the same value. CI builds the PR's exact head rather than the pull-request merge ref and verifies the production image HTML exposes the same deployment identity through Next.js' generated `data-dpl-id` marker.

This uses the supported Next.js deployment-skew mechanism. It does **not** automatically retry or replay a Server Action mutation.

### Server Action encryption key

No new `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` is introduced. Axora's production compose topology has one active application service instance, and no evidence showed mismatched encryption keys as the incident cause. A secret rotation/configuration change would therefore be unjustified in this prompt.

## Cache/proxy conclusion

The repository Caddy configuration has no response cache directive for application HTML, RSC responses, Server Action responses, or authenticated portal pages. The audit found no repository evidence that Caddy is serving a cached old action response. No live Caddy edit is required or permitted.

## Session/authentication conclusion

Prompt 5 access-changing commands reauthorize through the existing authorization and user-isolation layers. Authority-changing operations retain the existing auth-version/session invalidation lifecycle. The administrator profile-metadata operation does not depend on a second request to create session state.

No code in this PR weakens RLS, role scope, permission delegation, approval limits, last-Platform-Owner protection, or invitation lifecycle rules.

## Duplicate-side-effect review

No general mutation retry loop was added.

- account creation/invitation retains existing transaction and invitation lifecycle protection;
- request creation retains its client submission key/idempotent persistence behavior;
- approvals/budget/delivery retain their existing command/state/idempotency rules;
- Prompt 5 role/scope replacement retains its command UUID/database idempotency behavior;
- the error-boundary Retry button invokes the framework boundary reset only; it does not replay submitted form data or automatically re-run a write.

## Observability change

`src/instrumentation.ts` uses the supported Next.js request-error hook to emit a small JSON event containing only:

- event name;
- timestamp;
- deployment revision;
- HTTP method;
- route pattern and route type;
- router kind;
- broad error category;
- sanitized framework digest reference when available.

It deliberately excludes request headers, cookies, query strings, form payloads, raw exception messages, stack traces, email addresses, database identifiers, and tokens.

The browser displays only `AX-<validated digest>` when a framework digest is safe to show. This lets an operator correlate a boundary with server logs without disclosing internals.

## Reusable browser reliability guard

`e2e/helpers/reliability.ts` fails a critical happy-path test on:

- unexpected `pageerror`;
- unexpected `console.error`;
- unexpected failed requests (excluding browser-aborted navigation requests);
- any HTTP 5xx;
- the Axora portal unexpected-error boundary.

The first-attempt regression asserts one click produces exactly one Server Action POST. It does not warm up the action and does not retry it.

## Verification layers

The branch adds/uses these complementary layers:

1. unit/source-contract tests for diagnostic-reference sanitization, boundary content, privacy-minimized observability, deployment-ID build ordering, redirect-control-flow ordering, and the reusable browser guard;
2. existing native PostgreSQL Prompt 5 coverage for first-call profile persistence, role/scope transactionality, permission behavior, invitation lifecycle, rollback, RLS/grants, and protected administrators;
3. Playwright first-attempt profile success and expected-invalid profile behavior with the reliability guard;
4. CI production build and standalone/browser coverage;
5. CI production-container smoke proof that the exact PR-head deployment identity is embedded in the built application.

## Production evidence limitation / stop condition

This repository execution environment does not expose the live `axora-server` shell. Available historical host output and the captured production People & Access page can be reviewed, but the incident-time application log cannot be queried from here.

Consequently, before the incident itself can be declared fully root-caused, the human operator must correlate the reported failure window against the production app logs and capture, in sanitized form, any matching digest/reference, exception category, route/action, and deployed SHA. If no matching event exists, that absence is itself evidence that should be investigated rather than replaced with an assumption.

## Post-deployment production acceptance plan (operator only)

Do not run these steps until the PR is reviewed, merged, and deployed through the normal host-controlled procedure.

1. **Fresh People & Access profile change**
   - hard/fresh load the target management page;
   - change one safe profile field;
   - click Save exactly once;
   - verify first-attempt success and persistence after navigation/reload;
   - verify no generic recovery boundary.
2. **Second reversible access mutation**
   - on a controlled non-protected test account, change one safe permission/role-related field permitted by policy;
   - submit once;
   - verify first-attempt success, audit history, and persisted effective access;
   - restore only through a separately explicit operator action if restoration is required.
3. **Expected validation**
   - submit an intentionally invalid field through a normal UI that permits server validation;
   - verify local feedback and no HTTP 5xx/recovery boundary.
4. **Unexpected boundary sanity**
   - verify the boundary through test/staging or the automated suite only; do not intentionally crash production.
5. **Deployment-skew acceptance**
   - keep one authorized, non-destructive Axora tab open before a normal deployment;
   - deploy the reviewed release through the existing operator procedure;
   - use the old tab for safe navigation first and verify it converges to the new deployment;
   - do not deliberately replay a money/access mutation to manufacture uncertainty;
   - verify no refresh loop and no automatic write replay.
6. **Logs**
   - inspect the app log for the acceptance window;
   - verify no new relevant `next_request_error`, digest, SQLSTATE, unexpected 5xx, or uncaught exception;
   - if an error reference appears in UI, verify it maps to exactly one sanitized server event.

## Remaining risks

1. The exact exception for the reported Prompt 5.1 first-attempt production incident is not present in the evidence available to this repository session; the incident-specific root cause therefore remains unproven.
2. Supported `deploymentId` hard-navigation behavior is covered by build/configuration/container evidence, but a real two-release browser session still requires operator acceptance after deployment.
3. Several older organization/settings/company/request form actions still depend on strong client/native validation ahead of direct server schema parsing. They were inventoried; broad product-form rewrites were deliberately not mixed into the focused Prompt 5.1 patch. Future edits should adopt typed local action feedback rather than adding more direct user-input throws.
