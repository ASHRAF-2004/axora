export const AXORA_ORIGIN = "https://axora.management";
export const AXORA_API_BASE = `${AXORA_ORIGIN}/api/v1`;

export const AXORA_SCOPES = [
  "companies:read",
  "requests:read",
  "requests:draft",
  "deliveries:read",
  "invoices:read",
  "webhooks:manage",
] as const;

export const AXORA_SCOPE = AXORA_SCOPES.join(" ");

export const AXORA_EVENT_TYPES = [
  "request.created",
  "request.submitted",
  "request.approved",
  "invoice.finalized",
  "delivery.out_for_delivery",
  "delivery.completed",
] as const;

export type AxoraEventType = (typeof AXORA_EVENT_TYPES)[number];
