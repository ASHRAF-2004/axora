# Axora payment and invoice operating rules

## Customer flow

An authorised company user selects **Pay** only after the request is approved.
Axora recalculates the approved snapshot on the server, records the payment as
paid, assigns one permanent invoice number, and queues one final invoice PDF.

When the PDF is generated, Axora queues exactly one transactional invoice email
through the existing outbox, email sender, Resend provider, and signed lifecycle
webhook path. The finalized PDF is attached directly to the email.

## Separation of state

Payment, invoice, email delivery, fulfilment, physical delivery, and customer
receipt are independent states. Email failure does not reverse a paid payment or
a finalized invoice. Payment does not imply that physical delivery occurred.

## Current strategy and future providers

The current testing-stage strategy records the trusted checkout as paid without
an online gateway. This strategy identifier is internal and is not shown to
customers. A future gateway or reviewed manual-confirmation adapter can produce
the same trusted paid event; downstream invoice, PDF, email, and audit behavior
does not depend on the provider.

## Controls

- Totals and line values are server-authoritative.
- Checkout authorization and writes occur in one database transaction.
- One request can create one checkout invoice, one payment, one document job,
  and one logical invoice email.
- Final invoice data is immutable and does not use live catalog prices.
- Cross-tenant payment, invoice, document, and email access fails closed.
- Supplier invoices and internal procurement finance remain separate.
