# Workbook import assessment

Status: blocked for production import. Audit completed 2026-08-02. No workbook
row was written to Axora and no database reset was run.

## Source identity and handling

The assessed source is `Axora excelsheet database of products (version 1).xlsx`:

| Property | Audited value |
| --- | --- |
| Size | 215,524 bytes |
| Last modified | 2026-08-01 17:07:00 +08:00 |
| SHA-256 | `2b33d524557fcfa2112e2685a98faef2276f0fad129b200be82ed183620f6064` |
| Visible sheets | 6 |
| Hidden sheets | 0 |
| Defined names | 0 |

The source directory contained no PDF files despite its name. Personal contact
cell values were deliberately not copied into this report. The workbook does
not contain usable account email fields or plaintext credentials.

## Import verdict

The workbook is a planning artifact, not a relational master-data export. It
must not be loaded directly into production because:

- referenced Company Master, Branch Master, Operations Tracker, and structured
  Request Source data are absent;
- user-like rows lack account email addresses and contain unresolved scopes;
- recurring products all lack size, buying cost, and selling price;
- catalog status/confirmation columns are shifted and one cell was corrupted
  by an accidental Excel table header;
- branch coverage has one known unmapped branch and one unintended formula in
  a contact field;
- progress formulas count the wrong columns and report false zero values; and
- multiple generic workflow diagrams conflict and are not Axora-specific.

The safe disposition is **stage, normalize, review, and reconcile**. Nothing in
this workbook is authorized to overwrite a live row solely because a name
looks similar.

## Sheet inventory

| Sheet | Used range / observed rows | Formula and validation findings | Import disposition |
| --- | --- | --- | --- |
| Instructions | `B2:H28`; 26 XML rows | No formulas; one merge; two embedded diagrams extend beyond the declared dimension | Reference only |
| Accounts and access permissions | `A1:M56`; 56 rows | No formulas; two merges; five stale/misaligned validations | Roles may inform review; assignments blocked |
| Recurring Product List | `A1:Q59`; 26 populated data rows (`4:29`) | Six validations are shifted; no usable size or price values | Quarantine in staging |
| General Product Catalog (MY) | `A1:O60`; 57 populated products | Three validations are incomplete/shifted; accidental table `A52:O60` | Quarantine in staging |
| Branch Coverage | `A1:H20`; 15 populated XML rows | One unintended formula; five merges | Blocked pending branch master |
| Progress Summary | `B2:G9`; 7 rows | 13 formulas; key formulas reference wrong columns/sheets | Recalculate outside workbook |

## Detailed findings

### Accounts and access permissions

The sheet contains role descriptions, a role matrix, and 12 assignment-like
rows. It does not contain a structured department/request-source dataset even
though its title mentions those concepts.

The reference roles are Company Administrator, Branch Administrator, Branch
Approver, Company Approver, Purchase Requester, Finance Reviewer, Read-Only
Auditor, and Technical Support Admin. It also uses “Omega Admin” and “Super
Admin” for overlapping all-system concepts.

Blocking data quality issues:

- one assignment-like row has no company scope;
- two have no branch scope;
- two have no permission text;
- some rows are role placeholders rather than people;
- company and branch labels vary in spelling, spacing, and suffixes;
- one requester lacks the branch required by the application;
- the finance-review and read-only rows are incomplete;
- the technical-support description is broader than current code;
- a company-wide approver cannot be represented by the current single-company,
  single-branch `APPROVER` model; and
- the permission matrix is semantically shifted across module columns.

No assignment may become a login until an approved work email, canonical
display name, company identifier, role key, and any required branch identifier
are supplied. Platform owners remain a manual provisioning operation. See
[ROLE_MATRIX.md](ROLE_MATRIX.md).

### Recurring Product List

There are 26 populated demand rows:

| Company label | Rows | Confirmed in the actual confirmation column |
| --- | ---: | ---: |
| YourUni | 13 | 3 |
| Excel | 7 | 2 |
| Unibax | 6 | 1 |
| **Total** | **26** | **6** |

Other reconciled counts:

- categories: pantry 8, cleaning 8, office 6, printing 3, IT 1;
- frequency: monthly 14, weekly 9, ad hoc 3;
- all 26 rows are missing size, Axora buying cost, and customer selling price;
- three product names repeat across companies; this may be intentional demand
  duplication, but no stable product identifier proves the match; and
- the six validations are applied to the wrong fields. Status choices appear
  on Unit, Yes/No on Supplier, and request-source choices on Selling Price.

Only six rows are genuinely confirmed by the actual confirmation column. The
other 20 are candidates derived from estimates. Confirmation is demand
evidence, not permission to publish a product or invent missing prices.

### General Product Catalog (MY)

The catalog has 57 populated rows, 57 distinct supplied product IDs, and 57
distinct names across six categories. All buying and selling price cells parse
as numbers, and selling price exceeds buying price in all 57 rows. Calculated
margin ranges from 16% to 60%, with a median of 28%.

Those internally coherent prices do not make the sheet authoritative:

- the Status column contains `No` in every row instead of the expected
  Active/Inactive/Discontinued domain;
- the Confirmed column contains 56 `No` values and one `No2` value;
- category validation ends at row 53 although data continues to row 60;
- status validation is attached to Description rather than Status and also
  ends at row 53;
- Yes/No validation is attached to Status rather than Confirmed; and
- Excel table `Table1` starts at row 52, treating a product row as headers.
  Excel renamed the duplicated `No` header to `No2`, corrupting that product's
  confirmation cell.

All 57 rows therefore enter staging as `needs_review`; none may be published as
an active catalog record without row-level approval. Existing production
products must be matched by stable reviewed identifiers, not name alone.

### Branch Coverage

The summary claims four registered branches: one YourUni, two Excel, and one
Unibax. Only three have explicit mappings. The second Excel branch is marked as
an unresolved gap with its identifier still to be determined.

Company and branch labels are free text and inconsistent with other sheets.
Addresses and contacts require canonical master records. One contact-shaped
cell is an unintended arithmetic formula whose cached result must not be
treated as contact data. Do not infer or repair it automatically.

### Progress Summary

The recurring-row formulas correctly produce 13, 7, and 6. The confirmation
formulas count the Supplier column rather than the actual confirmation column,
so their cached zeros are wrong. The reconciled confirmed counts are 3, 2, and
1, for a total of 6.

The company targets are 20, 15, and 10, for a total of 45. Therefore:

- logged recurring rows: 26 / 45 = 57.8%;
- confirmed recurring rows: 6 / 26 = 23.1% of logged rows; and
- confirmed recurring rows: 6 / 45 = 13.3% of target.

Request-source formulas count the first column of the Accounts sheet, which
contains roles and matrix labels rather than company request sources. Their
zero values have no valid source basis.

### Embedded procurement diagrams

The workbook contains a seven-step circular diagram and a separate ten-stage
flow. A standalone image in the source directory depicts a third, nine-step
flow. They disagree, omit Axora's explicit system evidence, and have no declared
precedence. They must not generate status transitions. The canonical proposed
workflow is defined in [ARCHITECTURE.md](ARCHITECTURE.md).

## Canonical import contract

Every future import must first write to isolated staging tables or a disposable
database. A staged row needs, at minimum:

- import batch ID, workbook SHA-256, sheet name, source row number, and raw-row
  hash;
- raw values preserved separately from normalized values;
- a canonical entity type and proposed stable external key;
- validation state: `candidate`, `needs_review`, `accepted`, or `rejected`;
- machine-readable issue codes and a human review note; and
- reviewer identity and decision timestamp for accepted rows.

Required entity inputs:

| Entity | Required before acceptance |
| --- | --- |
| Company | Approved stable key, canonical name, active state, billing policy, and approved contact fields |
| Branch | Stable key, approved company key, canonical name/code, complete delivery address, active state |
| Product | Stable source ID, canonical name, category, unit, size/packaging as applicable, positive buy/sell price, status, confirmation decision |
| Recurring demand | Company key, product key, frequency, estimated quantity, request source, and evidence for confirmation |
| User invitation | Work email, display name, approved role key, company key, required branch key; never a plaintext password |

Normalization may trim whitespace, normalize case for matching, and map an
approved alias table. It must not silently merge companies, branches, or
products, invent missing values, convert `No` into a catalog status, or infer a
person's email or permission scope.

## Required import sequence

1. Obtain signed-off Company Master, Branch Master, request-source data, and
   account roster with work emails.
2. Obtain a corrected catalog export with intact headers, validation ranges,
   statuses, confirmations, and stable IDs.
3. Supply size and price fields for recurring items or explicitly match each
   one to an approved catalog ID.
4. Stage the immutable source and emit a row-level validation report.
5. Review all aliases, duplicates, unmapped roles, price changes, and branch
   gaps with business owners.
6. Dry-run into a disposable migrated database and reconcile source, staged,
   accepted, inserted, updated, skipped, and rejected counts.
7. Require zero blocking errors, zero unreviewed merges, and explicit approval
   of every proposed production mutation.
8. Only then consider the guarded database-switch process in
   [MIGRATION_AND_RESET_PLAN.md](MIGRATION_AND_RESET_PLAN.md).

Until these gates pass, the workbook is reference-only. It is not sufficient
recovery material for the production data that a reset would omit.
