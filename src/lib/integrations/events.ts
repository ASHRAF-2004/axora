export const INTEGRATION_EVENT_TYPES = [
  "company.created",
  "request.created",
  "request.submitted",
  "request.approved",
  "request.rejected",
  "invoice.finalized",
  "delivery.out_for_delivery",
  "delivery.arrived",
  "delivery.delivered",
  "delivery.completed",
] as const;

export type IntegrationEventType = (typeof INTEGRATION_EVENT_TYPES)[number];

export const INTEGRATION_EVENT_TYPE_SET: ReadonlySet<string> = new Set(
  INTEGRATION_EVENT_TYPES,
);
