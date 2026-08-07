import type { AuthenticatedSessionUser } from "./auth";
import {
  listAttachments,
  listDeliveries,
  listInvoices,
} from "./operations";
import { listAuthorizedRequests } from "./request-reader";

export async function loadAuthorizedDocumentRegisters(
  actor: AuthenticatedSessionUser,
) {
  const [requests, allInvoices, allDeliveries, allAttachments] =
    await Promise.all([
      listAuthorizedRequests(actor),
      listInvoices(),
      listDeliveries(),
      listAttachments(),
    ]);
  const requestIds = new Set(requests.map((request) => request.id));
  const requestLineIds = new Set(
    requests.flatMap((request) => request.lines.map((line) => line.id)),
  );
  const invoices = allInvoices.filter((invoice) => (
    requestIds.has(invoice.requestId)
  ));
  const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
  const deliveries = allDeliveries.filter((delivery) => (
    requestLineIds.has(delivery.requestLineId)
  ));
  const deliveryIds = new Set(deliveries.map((delivery) => delivery.id));
  const platformView = actor.isOwner || actor.accountKind === "PLATFORM";
  const attachments = allAttachments.filter((attachment) => {
    if (!platformView && attachment.visibility !== "CUSTOMER") return false;
    if (attachment.entityType === "request") {
      return requestIds.has(attachment.recordId);
    }
    if (attachment.entityType === "invoice") {
      return invoiceIds.has(attachment.recordId);
    }
    if (attachment.entityType === "delivery") {
      return deliveryIds.has(attachment.recordId);
    }
    return false;
  });

  return { requests, invoices, deliveries, attachments };
}
