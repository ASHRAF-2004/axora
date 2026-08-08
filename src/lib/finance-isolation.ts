import type { AuthenticatedSessionUser } from "./auth";
import {
  listAuthorizedInvoices,
  listAuthorizedPayments,
} from "./operational-isolation";
import { listAuthorizedRequests } from "./request-reader";

export async function loadAuthorizedFinanceRegisters(
  actor: AuthenticatedSessionUser,
) {
  const [requests, invoices, payments] = await Promise.all([
    listAuthorizedRequests(actor),
    listAuthorizedInvoices(actor),
    listAuthorizedPayments(actor),
  ]);

  return { requests, invoices, payments };
}
