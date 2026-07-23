# MVP cash-on-delivery operating rules

## 1. Scope and rule

These rules apply to the invite-only Axora MVP used by the three authorized
pilot companies in Malaysia.

The only approved payment method is **cash on delivery (COD)**. In this pilot,
COD means that the seller or its authorized delivery representative receives
physical cash only when the goods are delivered and the accepted quantity is
confirmed. Axora records evidence but does not receive, hold, deposit, or settle
cash for a seller.

Important: COD is a safety and operating boundary for this MVP only; it is not
the final product vision for Axora. After the pilot, any other payment method
may be evaluated as a separate project with its own security, compliance,
Finance, and operational approval. Do not enable it by changing this document
or by bypassing the application's COD validation.

The following methods are not allowed during the MVP:

- Credit or debit cards.
- FPX, DuitNow, bank transfer, e-wallet, or QR payment.
- Credit terms, instalments, or buy-now-pay-later.
- Any unapproved substitute described as COD.

Do not store card, online-banking, or customer bank credentials in Axora or in
its uploaded documents.

## 2. Required transaction sequence

Use this sequence for every COD transaction:

1. Confirm that the company, request, quotation, approval, and order are
   authorized.
2. Schedule the delivery and identify the buyer's receiver and the seller's
   authorized cash collector.
3. At delivery, the buyer checks the item, accepted quantity, condition, and
   delivery evidence before any cash is collected.
4. The seller or its authorized delivery representative collects only the
   amount due for the quantity actually accepted.
5. The seller or its authorized delivery representative issues a numbered
   receipt to the payer.
6. An authorized Axora Finance user records the payment evidence using the exact method name
   `Cash on delivery (COD)`. Enter the actual date, amount, receipt/reference
   number, and related invoice.
7. Retain the delivery evidence and receipt according to the company's approved
   records policy.
8. Finance reconciles the Axora record, invoice, delivery evidence, amount, and
   seller-issued receipt. Any difference is reported immediately to the seller
   and order owner; Axora does not take custody of the cash.

Never mark an invoice as paid before the cash and supporting evidence have been
received and checked.

## 3. Exceptions

### Partial delivery

Collect only the amount approved for the quantity actually received. Record the
accepted quantity and delivery evidence. The remaining balance stays unpaid
until the remaining goods are delivered or the authorized order is adjusted.

### Failed, rejected, or cancelled delivery

Do not collect cash. Record the delivery outcome and escalate it to the order
owner. Do not create a payment record to make the order appear complete.

### Incorrect amount or duplicate collection

Stop processing, preserve all evidence, and notify the supervisor and Finance.
Refunds, returns, write-offs, and corrections require the company's approved
manual process; Axora does not automate these decisions.

## 4. Minimum evidence for each payment

Finance should be able to match each payment to all of the following:

- Pilot company and order/invoice identifier.
- Delivery date, delivered items, and accepted quantity.
- Proof of delivery or acceptance.
- Exact cash amount collected.
- Unique numbered receipt or reference.
- Name of the seller's authorized collector or delivery representative.
- Date and name of the Finance reviewer.
- Reconciliation result and details of any variance.

Do not combine evidence from different companies or transactions; keep one
clear receipt and invoice reference for each COD collection.

## 5. Responsibilities that must be approved manually

Before live use, the supervisor and Finance must decide and document:

- Which sellers and named delivery representatives may collect cash and issue
  receipts. Axora staff and the intern must not act as cash custodians.
- The seller's receipt numbering method and how Axora stores a copy or reference.
- Maximum COD amounts and the seller's confirmation that it owns cash custody,
  secure storage, handover, deposit, and counterfeit-note controls.
- How Finance verifies the seller-issued receipt without handling the cash.
- How partial deliveries, rejected goods, refunds, shortages, overpayments,
  counterfeit notes, and lost receipts are handled.
- How long delivery and payment evidence must be retained under the company's
  approved policy.

These are company and Finance decisions. This document does not invent approval
limits or replace the company's accounting, security, tax, or legal policies.

## 6. Software enforcement and remaining manual controls

The Finance, company, and supplier forms use the fixed method
`Cash on delivery (COD)`. Server validation, core payment logic, and database
constraints reject other values. Demo data and seed records use the same value.

Migration `002_cod_only_payments.sql` normalizes known demo or COD aliases and
stops if an unknown existing non-COD record is found; Finance must review that
record rather than allowing it to be silently rewritten.

The legacy fallback workbook is separate from the application and does not
receive database migrations. Before it is used for the MVP, manually replace
the old examples in `Company Master!K2:K4` and `Supplier Master!I2:I11` with the
exact text `Cash on delivery (COD)`. Keep the original workbook archived and
save the COD-only copy with a new date or version name.

The software does not control the seller's physical cash custody, receipt book,
storage, bank deposit, or counterfeit-note checks. Refund and exception
decisions are not automated. A named Finance reviewer must therefore check every
live payment record and its evidence even though the method is technically fixed.

## 7. Daily closing check

At the end of each operating day, the assigned Finance reviewer should confirm:

- Every cash receipt has one matching Axora payment record.
- Every Axora payment record has delivery evidence and a numbered receipt.
- Recorded amounts equal the amounts shown on seller receipts for accepted deliveries.
- The seller remains responsible for cash handover, secure storage, and deposit.
- Every difference or missing document has an incident owner and follow-up.

The reviewer records their name, date, result, and any unresolved variance in
the company's approved reconciliation record.
