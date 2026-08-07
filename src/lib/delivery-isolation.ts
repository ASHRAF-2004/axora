import type { AuthenticatedSessionUser } from "./auth";
import { listDeliveries } from "./operations";
import { listAuthorizedRequests } from "./request-reader";

export async function loadAuthorizedDeliveryRegisters(
  actor: AuthenticatedSessionUser,
) {
  const [requests, allDeliveries] = await Promise.all([
    listAuthorizedRequests(actor),
    listDeliveries(),
  ]);
  const requestLineIds = new Set(
    requests.flatMap((request) => request.lines.map((line) => line.id)),
  );
  const deliveries = allDeliveries.filter((delivery) => (
    requestLineIds.has(delivery.requestLineId)
  ));

  return { requests, deliveries };
}
