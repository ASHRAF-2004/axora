# Session and Route Preservation Runtime

## Purpose

P0-03 restores authenticated Axora sessions before protected pages decide access
and preserves the user's current authorized workspace across refresh, session
expiry, reauthentication, onboarding, network interruption, and multiple tabs.

The runtime preserves only safe state:

- pathname;
- query parameters, including filters and pagination;
- URL fragment, including client-selected tabs or anchors;
- request form fields that contain no secret or internal price data;
- user- and company-scoped request cart contents; and
- one per-draft request submission identity.

Passwords, session tokens, cookie values, raw network identifiers, browser
signals, provider secrets, authorization snapshots, private identity hashes, and
file bytes are never placed in browser draft storage or return URLs.

## Trusted return-route flow

### Proxy

The proxy deletes any meaning attached to a caller-supplied return header and
rebuilds `x-axora-return-to` from Next's parsed same-origin pathname and query.
The header is bounded to 2,048 characters.

### Portal layout

The portal layout reads the trusted header before resolving the session. A
missing cookie produces a `required` login state. A cookie that exists but no
longer resolves to a live account, assignment, or session produces an `expired`
state. Both redirects include the validated protected pathname and query.

A neutral localized loading state says that Axora is checking the secure
session. It does not flash the login page, claim the user is being signed out,
or clear the current route.

### Fragment recovery

URL fragments are not sent to the server. A small client continuity component
records the current protected pathname, query, and fragment in session storage.
On login, the fragment is merged only when the server-provided pathname and
query exactly match the stored pathname and query.

### Login

`safeInternalReturnPath` rejects:

- another origin;
- protocol-relative paths;
- credentials in a URL;
- control characters;
- encoded or literal backslashes;
- oversized values;
- API, authentication, static, and unknown routes.

`authorizedSessionReturnPath` then checks the recognized route against the
current role's effective application permission. A malformed, external,
unrecognized, or unauthorized route falls back to that role's canonical landing
page.

Mandatory profile onboarding carries the same validated return path. After the
profile is completed, Axora resumes the authorized destination and adds the role
tutorial marker without discarding existing query parameters or the fragment.

## Session lifecycle

The existing session remains an HTTP-only, secure production cookie backed by a
hashed token in `user_sessions` and the live account authorization version.

Routine authenticated actions no longer redirect through a blanket current-
password challenge. They continue to revalidate the live session, permission,
scope and database write authority. Password changes remain exceptional and
verify the current password before rotating the authorization version and
session. All tabs share the browser cookie jar and converge on the new token.
Explicit logout clears the server session and only the current user/company
browser cart, draft, and route marker.

Immediate assignment revocation, account suspension, password changes, and
authorization-version increments continue to invalidate prior signed cookies.

## Browser draft isolation

### Request cart

The old `axora-request-cart:v1` key had no user or tenant identity. It is deleted
rather than migrated because assigning it to the next person who signs in could
leak a previous user's draft.

The current key is derived from:

- storage version;
- authenticated user ID; and
- company ID, or an explicit no-company marker.

A different user in the same browser and the same user in a different company
receive different namespaces.

### Request draft

Only these fields are persisted:

- branch ID;
- department display text;
- needed-by date;
- request type;
- urgency;
- notes;
- submission key; and
- update timestamp.

Stored values are bounded and validated before restoration. Product selections
remain in the separately scoped request cart. Supplier selection, buying cost,
payment data, authentication material, and private authorization facts are not
stored.

The draft and cart are cleared only after the server redirects with
`notice=request-submitted`, proving that the transaction committed. An
interrupted request or lost redirect therefore retains the draft safely.

### Shared portal form drafts

Suitable authenticated forms also use a shared session-storage draft manager.
Its namespace includes schema version, user, live role/scope assignment, route
and form signature. It stores only bounded text/select/checkbox values, expires
records after seven days, restores after refresh or route recovery, and clears
only after a successful action signal. Passwords, bearer/setup/reset tokens,
cookies, credentials, API/webhook/private keys, payment secrets and file bytes
are excluded. File selection is represented only by a reminder to reselect the
file. A different account or tenant scope cannot resolve another draft key.

## Retry-safe request submission

Migration 050 adds nullable `requests.client_submission_key` and a partial unique
index on `(created_by, client_submission_key)`.

Historical rows remain unchanged with a null key. Every new browser draft gets a
UUID. Repeating the same submission from the same creator returns the original
request instead of inserting another request. The same key may be used by a
different creator without collision.

The production writer:

1. checks for a prior creator/key pair;
2. locks and authorizes the requested company, branch, and department;
3. validates the live catalogue rows;
4. inserts with `ON CONFLICT ... DO NOTHING`;
5. resolves a concurrent winning insert when necessary; and
6. creates request lines, totals, workflow events, and notifications only for the
   winning request.

The submission key becomes immutable after insertion.

## Offline and error states

A localized English, Arabic, or Malay banner appears when the browser loses
connectivity. The active page is not cleared. Safe request state remains in its
scoped browser namespace. A brief restoration message appears after reconnect.

The portal error boundary distinguishes offline state, keeps the current route,
and exposes a retry button only when the browser is online.

Axora does not claim full offline operation: writes still require a live server
and current authorization. The goal is to avoid silent data loss and accidental
logout during a temporary connection failure.

## Multi-tab behavior

Each tab records its own active pathname, query, and fragment in session storage.
The secure session cookie remains shared. Refreshing one tab does not redirect a
second tab to another route, and rotating or revoking the session affects every
tab through the shared cookie and live database session checks.

Local request drafts use local storage so the same user's request can survive a
hard refresh, but the key is user/company scoped to prevent cross-login leakage.

## Migration and rollback

Migration 050 is additive. It does not delete, rewrite, or renumber users,
sessions, assignments, requests, lines, workflow events, companies, branches,
departments, documents, visitors, or audit history.

Rollback is forward-fix only after migration. A corrective migration may replace
the unique index or submission trigger, but production data must not be reset and
submission identities must not be reassigned.

## Verification requirements

Release is blocked unless all of the following pass:

- safe return path, open-redirect, malformed path, and role authorization tests;
- path, query, fragment, filter, and pagination preservation;
- missing and expired session recovery;
- onboarding destination preservation;
- current-password verification and session rotation for password changes;
- per-user and per-company cart and draft separation;
- legacy unscoped cart removal;
- request draft restoration and successful-submission cleanup;
- request submission uniqueness, immutability, and concurrent retry behavior;
- refresh coverage for platform, company, supplier, delivery, receiving, support,
  and requester workspaces;
- multiple-tab route retention;
- offline and reconnect behavior;
- complete migration chain and populated upgrade through migration 050;
- lint, TypeScript, full unit/integration/security tests, production build,
  desktop/mobile browser journeys, visitor recovery, deployment assets, and
  production container verification.

## Routine actions and form progress

Routine authenticated portal actions no longer invoke blanket password step-up.
The primary login, live database session check, auth-version revocation, CSRF
controls, route permission checks, RLS, scope capabilities, and immutable audit
trail remain mandatory. Current-password verification remains limited to
credential changes and password recovery.

The shared portal draft manager stores only allowlisted, non-sensitive form
values in sessionStorage. Keys bind the draft to user, company/branch/department
scope, route, form identifier, and schema version. Drafts expire after seven days,
restore after refresh or recovery, clear after successful submission, and expose
a discard action. Passwords, tokens, cookies, API/webhook keys, payment secrets,
private material, and file contents are always excluded; file controls require
reselection.
