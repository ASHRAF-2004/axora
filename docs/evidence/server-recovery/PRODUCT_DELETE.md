# Product deletion recovery evidence

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
