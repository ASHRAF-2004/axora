import type { AuthenticatedSessionUser } from "./auth";
import { listInvoices, listPayments } from "./operations";
import { listAuthorizedRequests } from "./request-reader";

export async function loadAuthorizedFinanceRegisters(
  actor: AuthenticatedSessionUser,
) {
  const [requests, allInvoices, allPayments] = await Promise.all([
    listAuthorizedRequests(actor),
    listInvoices(),
    listPayments(),
  ]);
  const requestIds = new Set(requests.map((request) => request.id));
  const invoices = allInvoices.filter((invoice) => (
    requestIds.has(invoice.requestId)
  ));
  const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
  const payments = allPayments.filter((payment) => (
    invoiceIds.has(payment.invoiceId)
  ));

  return { requests, invoices, payments };
}
