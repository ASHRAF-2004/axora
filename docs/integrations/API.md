# Axora external API v1

Base URL: `https://axora.management/api/v1`

The contract is also available as OpenAPI 3.1 at
`GET /api/v1/openapi.json` while the external API feature is enabled.

## Authentication

Send an opaque OAuth bearer token:

```http
Authorization: Bearer axora_at_REDACTED
```

Access tokens last 15 minutes. Refresh tokens rotate on every use and expire
after at most 30 days; their family and grant expire after at most 90 days.
Reusing a consumed refresh token marks the family compromised and revokes its
access. Tokens are restricted by their scopes and by the delegating user's
live Axora authorization on every request.

OAuth discovery is available at
`/.well-known/oauth-authorization-server`. The supported flow is Authorization
Code with PKCE S256:

- authorization endpoint: `/oauth/authorize`
- token endpoint: `/oauth/token`
- revocation endpoint: `/oauth/revoke`
- response type: `code`
- grant types: `authorization_code`, `refresh_token`
- PKCE method: `S256` only

Redirect URIs must be exact, pre-registered HTTPS values. Every authorization
request requires a cryptographically unpredictable client `state` value and a
PKCE challenge. Axora never shares the user's password with a client.

## Endpoints

| Method | Path | Required scope | Purpose |
| --- | --- | --- | --- |
| GET | `/me` | authenticated token | Current delegation, connection, and scopes |
| GET | `/companies` | `companies:read` | Connected company's safe profile |
| GET | `/companies/{id}` | `companies:read` | Connected company by ID |
| GET | `/requests` | `requests:read` | Authorized requests |
| GET | `/requests/{id}` | `requests:read` | Authorized request and safe line data |
| GET | `/deliveries` | `deliveries:read` | Authorized delivery status |
| GET | `/deliveries/{id}` | `deliveries:read` | Authorized delivery by ID |
| GET | `/invoices` | `invoices:read` | Customer-facing invoices |
| GET | `/invoices/{id}` | `invoices:read` | Customer-facing invoice by ID |
| POST | `/request-drafts` | `requests:draft` | Create a review-required staging draft |

The invoice and delivery representations omit Axora buying cost, supplier
cost, margin, raw GPS history, private proof paths, internal telemetry, and
security material. Foreign and nonexistent resource IDs use the same
`not_found` response.

## Response contract

Successful responses use a stable envelope:

```json
{
  "data": {},
  "meta": {
    "request_id": "00000000-0000-4000-8000-000000000000"
  }
}
```

Errors do not expose stack traces, SQL, table names, or provider details:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "The request is invalid.",
    "request_id": "00000000-0000-4000-8000-000000000000",
    "field": "limit"
  }
}
```

Every response carries `Axora-Request-Id`, `Cache-Control: no-store`, and
`X-Content-Type-Options: nosniff`. A caller may provide a UUID in
`Axora-Request-Id`; invalid values are replaced.

## Pagination

List endpoints accept `limit` from 1 to 100; the default is 25. A successful
page may return `meta.pagination.next_cursor`. Cursors are opaque, signed, and
bound to the route and connected company. Clients must not parse or edit them.
Unknown or repeated query parameters are rejected.

## Rate limits

API reads are limited per token, connection, and application. Writes use
tighter independent buckets. OAuth endpoints additionally use client/company
and keyed network buckets. Responses provide `RateLimit-Limit`,
`RateLimit-Remaining`, and `RateLimit-Reset`; a rejected request also provides
`Retry-After`. Rate keys never contain raw tokens, client secrets, or network
addresses.

## Request-draft idempotency

`POST /request-drafts` requires a unique `Idempotency-Key` of 8–128 safe ASCII
characters and an `application/json` body no larger than 64 KiB. A key is
scoped to the company connection and command, including across OAuth grant
rotation. The originating grant is retained as security evidence.

- Same key and canonical payload: the original `201` result is replayed with
  `meta.idempotency_replayed=true`.
- Same key and a different payload: `409 conflict` and no new draft.
- The key itself is never stored or logged; only a dedicated keyed hash is
  persisted.

Example body:

```json
{
  "branch_id": "00000000-0000-4000-8000-000000000001",
  "needed_by_date": "2026-09-30",
  "urgency": "Normal",
  "department": "Operations",
  "notes": "Review before submitting.",
  "items": [
    {
      "product_reference": "item-0123456789abcdefabcd",
      "quantity": 2,
      "specification": "Fictional example"
    }
  ]
}
```

The resulting draft must be opened in Axora, imported by an authorized
requester, reviewed, and submitted through the normal workflow. It is not a
purchase or financial commitment.
