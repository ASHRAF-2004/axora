import type { AuthenticatedSessionUser } from "./auth";
import { listQuotations, listSupplierRfqs } from "./operations";
import { listAuthorizedRequests } from "./request-reader";

export async function loadAuthorizedSourcingRegisters(
  actor: AuthenticatedSessionUser,
) {
  const [requests, allQuotations, allSupplierRfqs] = await Promise.all([
    listAuthorizedRequests(actor),
    listQuotations(),
    listSupplierRfqs(actor),
  ]);
  const requestLineIds = new Set(
    requests.flatMap((request) => request.lines.map((line) => line.id)),
  );
  const quotations = allQuotations.filter((quotation) => (
    requestLineIds.has(quotation.requestLineId)
  ));
  const supplierRfqs = allSupplierRfqs.filter((rfq) => (
    requestLineIds.has(rfq.requestLineId)
  ));

  return { requests, quotations, supplierRfqs };
}
