import type { AuthenticatedSessionUser } from "./auth";
import { listAuthorizedAttachments } from "./document-isolation";
import {
  listAuthorizedDeliveries,
  listAuthorizedInvoices,
} from "./operational-isolation";
import { listAuthorizedRequests } from "./request-reader";

export async function loadAuthorizedDocumentRegisters(
  actor: AuthenticatedSessionUser,
) {
  const [requests, invoices, deliveries, attachments] = await Promise.all([
    listAuthorizedRequests(actor),
    listAuthorizedInvoices(actor),
    listAuthorizedDeliveries(actor),
    listAuthorizedAttachments(actor),
  ]);

  return { requests, invoices, deliveries, attachments };
}
