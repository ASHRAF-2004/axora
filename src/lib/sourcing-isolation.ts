import type { AuthenticatedSessionUser } from "./auth";
import {
  listAuthorizedQuotations,
  listAuthorizedSupplierRfqs,
} from "./operational-isolation";
import { listAuthorizedRequests } from "./request-reader";

export async function loadAuthorizedSourcingRegisters(
  actor: AuthenticatedSessionUser,
) {
  const [requests, quotations, supplierRfqs] = await Promise.all([
    listAuthorizedRequests(actor),
    listAuthorizedQuotations(actor),
    listAuthorizedSupplierRfqs(actor),
  ]);

  return { requests, quotations, supplierRfqs };
}
