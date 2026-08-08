import type { AuthenticatedSessionUser } from "./auth";
import { listAuthorizedDeliveries } from "./operational-isolation";
import { listAuthorizedRequests } from "./request-reader";

export async function loadAuthorizedDeliveryRegisters(
  actor: AuthenticatedSessionUser,
) {
  const [requests, deliveries] = await Promise.all([
    listAuthorizedRequests(actor),
    listAuthorizedDeliveries(actor),
  ]);

  return { requests, deliveries };
}
