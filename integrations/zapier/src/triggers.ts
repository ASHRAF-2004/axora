import {
  defineInputFields,
  defineTrigger,
  type WebhookTriggerPerform,
  type WebhookTriggerPerformList,
  type WebhookTriggerPerformSubscribe,
  type WebhookTriggerPerformUnsubscribe,
} from "zapier-platform-core";

import {
  AXORA_API_BASE,
  AXORA_ORIGIN,
  type AxoraEventType,
} from "./constants.js";
import {
  absoluteAxoraUrl,
  stableIdempotencyKey,
  type AxoraEnvelope,
} from "./http.js";

interface TriggerDefinition {
  key: string;
  noun: "Request" | "Invoice" | "Delivery";
  label: string;
  description: string;
  eventType: AxoraEventType;
  resourceType: "request" | "invoice" | "delivery";
  sampleEventId: string;
  sampleData: Record<string, string>;
}

const inputFields = defineInputFields([]);

const outputFields = [
  { key: "id", label: "Event ID" },
  { key: "event_id", label: "Axora Event ID" },
  { key: "event_type", label: "Event Type" },
  { key: "schema_version", label: "Schema Version", type: "integer" as const },
  { key: "occurred_at", label: "Occurred At", type: "datetime" as const },
  { key: "company_id", label: "Company ID" },
  { key: "resource_id", label: "Resource ID" },
  { key: "resource_type", label: "Resource Type" },
  { key: "resource_url", label: "Open in Axora" },
  { key: "order_code", label: "Order Code" },
  { key: "invoice_number", label: "Invoice Number" },
  { key: "job_code", label: "Delivery Job Code" },
  { key: "branch_name", label: "Branch" },
  { key: "currency", label: "Currency" },
  { key: "total", label: "Customer Total" },
];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sampleFor(definition: TriggerDefinition) {
  const resourceId = definition.resourceType === "request"
    ? "00000000-0000-4000-8000-000000000101"
    : definition.resourceType === "invoice"
      ? "00000000-0000-4000-8000-000000000201"
      : "00000000-0000-4000-8000-000000000301";
  return {
    id: definition.sampleEventId,
    event_id: definition.sampleEventId,
    event_type: definition.eventType,
    schema_version: 1,
    occurred_at: "2026-01-15T02:30:00.000Z",
    company_id: "00000000-0000-4000-8000-000000000001",
    resource_id: resourceId,
    resource_type: definition.resourceType,
    resource_url: `${AXORA_ORIGIN}/api/v1/${definition.resourceType === "delivery" ? "deliveries" : `${definition.resourceType}s`}/${resourceId}`,
    ...definition.sampleData,
  };
}

function zapierTarget(value: unknown) {
  if (typeof value !== "string") throw new Error("Zapier did not provide a webhook target.");
  const target = new URL(value);
  if (
    target.protocol !== "https:"
    || target.hostname !== "hooks.zapier.com"
    || (target.port && target.port !== "443")
    || target.username
    || target.password
    || target.hash
  ) {
    throw new Error("Zapier provided an invalid webhook target.");
  }
  return target.href;
}

function safeString(value: unknown, maximumLength: number) {
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  const result = typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
  return result && result.length <= maximumLength ? result : undefined;
}

function webhookRecord(
  value: unknown,
  eventType: AxoraEventType,
  resourceType: TriggerDefinition["resourceType"],
) {
  const event = value as Record<string, unknown> | undefined;
  const data = event?.data as Record<string, unknown> | undefined;
  const collection = resourceType === "delivery" ? "deliveries" : `${resourceType}s`;
  if (
    !event
    || event.event_type !== eventType
    || event.resource_type !== resourceType
    || event.schema_version !== 1
    || typeof event.event_id !== "string"
    || !UUID_PATTERN.test(event.event_id)
    || typeof event.occurred_at !== "string"
    || event.occurred_at.length > 40
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(event.occurred_at)
    || Number.isNaN(Date.parse(event.occurred_at))
    || typeof event.company_id !== "string"
    || !UUID_PATTERN.test(event.company_id)
    || typeof event.resource_id !== "string"
    || !UUID_PATTERN.test(event.resource_id)
    || event.resource_url !== `/api/v1/${collection}/${event.resource_id}`
  ) return null;
  return {
    id: event.event_id,
    event_id: event.event_id,
    event_type: eventType,
    schema_version: 1,
    occurred_at: event.occurred_at,
    company_id: event.company_id,
    resource_id: event.resource_id,
    resource_type: resourceType,
    resource_url: absoluteAxoraUrl(event.resource_url),
    order_code: safeString(data?.order_code, 120),
    invoice_number: safeString(data?.invoice_number, 120),
    job_code: safeString(data?.job_code, 120),
    branch_name: safeString(data?.branch_name, 200),
    currency: safeString(data?.currency, 3),
    total: safeString(data?.total, 64),
  };
}

function buildTrigger(definition: TriggerDefinition) {
  const sample = sampleFor(definition);

  const performSubscribe = (async (z, bundle) => {
    const targetUrl = zapierTarget(bundle.targetUrl);
    const response = await z.request<AxoraEnvelope<Record<string, unknown>>>({
      url: `${AXORA_API_BASE}/webhook-subscriptions`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": stableIdempotencyKey(
          z,
          "hook-create",
          `${definition.eventType}\0${targetUrl}`,
        ),
      },
      body: {
        endpoint_url: targetUrl,
        event_types: [definition.eventType],
        credential_delivery: "none",
      },
    });
    const subscription = response.data.data;
    return {
      id: subscription.id,
      status: subscription.status,
      event_types: subscription.event_types,
    };
  }) satisfies WebhookTriggerPerformSubscribe<typeof inputFields>;

  const performUnsubscribe = (async (z, bundle) => {
    const subscriptionId = String(bundle.subscribeData?.id ?? "");
    if (!subscriptionId) return {};
    const response = await z.request<AxoraEnvelope<Record<string, unknown>>>({
      url: `${AXORA_API_BASE}/webhook-subscriptions/${encodeURIComponent(subscriptionId)}`,
      method: "DELETE",
      headers: {
        "Idempotency-Key": stableIdempotencyKey(
          z,
          "hook-revoke",
          subscriptionId,
        ),
      },
    });
    return response.data.data;
  }) satisfies WebhookTriggerPerformUnsubscribe<typeof inputFields>;

  const perform = ((_, bundle) => {
    const record = webhookRecord(
      bundle.cleanedRequest,
      definition.eventType,
      definition.resourceType,
    );
    return record ? [record] : [];
  }) satisfies WebhookTriggerPerform<typeof inputFields>;

  const performList = (() => [sample]) satisfies WebhookTriggerPerformList<typeof inputFields>;

  return defineTrigger({
    key: definition.key,
    noun: definition.noun,
    display: {
      label: definition.label,
      description: definition.description,
    },
    operation: {
      type: "hook",
      inputFields,
      performSubscribe,
      performUnsubscribe,
      perform,
      performList,
      sample,
      outputFields,
    },
  });
}

export const newRequest = buildTrigger({
  key: "new_request",
  noun: "Request",
  label: "New Request",
  description: "Triggers when Axora records a new purchase request.",
  eventType: "request.created",
  resourceType: "request",
  sampleEventId: "00000000-0000-4000-8000-000000001001",
  sampleData: {
    order_code: "ORD-FICTIONAL-1001",
    branch_name: "Fictional Kuala Lumpur Branch",
    currency: "MYR",
    total: "1250.00",
  },
});

export const requestSubmitted = buildTrigger({
  key: "request_submitted",
  noun: "Request",
  label: "Request Submitted",
  description: "Triggers when a purchase request enters Axora's approval workflow.",
  eventType: "request.submitted",
  resourceType: "request",
  sampleEventId: "00000000-0000-4000-8000-000000001002",
  sampleData: {
    order_code: "ORD-FICTIONAL-1002",
    branch_name: "Fictional Kuala Lumpur Branch",
    currency: "MYR",
    total: "990.00",
  },
});

export const requestApproved = buildTrigger({
  key: "request_approved",
  noun: "Request",
  label: "Request Approved",
  description: "Triggers after Axora durably records a request approval.",
  eventType: "request.approved",
  resourceType: "request",
  sampleEventId: "00000000-0000-4000-8000-000000001003",
  sampleData: {
    order_code: "ORD-FICTIONAL-1003",
    branch_name: "Fictional Johor Branch",
    currency: "MYR",
    total: "780.00",
  },
});

export const invoiceFinalized = buildTrigger({
  key: "invoice_finalized",
  noun: "Invoice",
  label: "Invoice Finalized",
  description: "Triggers when a customer-facing invoice is finalized in Axora.",
  eventType: "invoice.finalized",
  resourceType: "invoice",
  sampleEventId: "00000000-0000-4000-8000-000000001004",
  sampleData: {
    invoice_number: "INV-FICTIONAL-1001",
    order_code: "ORD-FICTIONAL-1003",
    branch_name: "Fictional Johor Branch",
    currency: "MYR",
    total: "780.00",
  },
});

export const deliveryOutForDelivery = buildTrigger({
  key: "delivery_out_for_delivery",
  noun: "Delivery",
  label: "Delivery Out for Delivery",
  description: "Triggers when an Axora delivery is durably marked out for delivery.",
  eventType: "delivery.out_for_delivery",
  resourceType: "delivery",
  sampleEventId: "00000000-0000-4000-8000-000000001005",
  sampleData: {
    job_code: "DEL-FICTIONAL-1001",
    order_code: "ORD-FICTIONAL-1003",
    branch_name: "Fictional Johor Branch",
  },
});

export const deliveryCompleted = buildTrigger({
  key: "delivery_completed",
  noun: "Delivery",
  label: "Delivery Completed",
  description: "Triggers after Axora durably records delivery completion.",
  eventType: "delivery.completed",
  resourceType: "delivery",
  sampleEventId: "00000000-0000-4000-8000-000000001006",
  sampleData: {
    job_code: "DEL-FICTIONAL-1002",
    order_code: "ORD-FICTIONAL-1004",
    branch_name: "Fictional Penang Branch",
  },
});

export const triggers = [
  newRequest,
  requestSubmitted,
  requestApproved,
  invoiceFinalized,
  deliveryOutForDelivery,
  deliveryCompleted,
] as const;
