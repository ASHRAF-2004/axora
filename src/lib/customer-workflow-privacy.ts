import type { RequestWorkflowEvent } from "./workflow-repository";
import type { WorkflowActorKind } from "./workflow-events";

const CUSTOMER_EVENT_KEYS = new Map<string, string>([
  ["quotation.requested", "preparation.started"],
  ["quotation.received", "preparation.updated"],
  ["supplier.selected", "preparation.updated"],
  ["order.confirmed", "preparation.updated"],
  ["driver.assignment_rejected", "preparation.updated"],
  ["delivery.accepted", "preparation.updated"],
  ["delivery.arrived", "delivery.updated"],
  ["delivery.attempted", "delivery.updated"],
  ["delivery.issue_reported", "delivery.updated"],
  ["delivery.note_added", "delivery.updated"],
  ["delivery.evidence_recorded", "delivery.updated"],
  ["delivery.partial_evidence_recorded", "delivery.updated"],
]);

const PREPARING_STATES = new Set([
  "AVAILABLE",
  "CLAIMED",
  "ASSIGNED",
  "ACCEPTED",
  "SHOPPING",
  "BUYING",
  "PURCHASING",
  "ITEMS_ACQUIRED",
  "AWAITING_DELIVERY",
]);

function customerSafeState(state: string | undefined) {
  if (!state) return undefined;
  const normalized = state.trim().replaceAll(" ", "_").toUpperCase();
  if (PREPARING_STATES.has(normalized)) return "PREPARING";
  if (normalized === "OUT_FOR_DELIVERY" || normalized === "ARRIVED") {
    return "OUT_FOR_DELIVERY";
  }
  if (normalized === "PARTIALLY_DELIVERED" || normalized === "DELIVERED") {
    return "DELIVERED";
  }
  if (normalized === "COMPLETED") return "COMPLETED";
  return state;
}

export function sanitizeCustomerWorkflowEvent(
  event: RequestWorkflowEvent,
  actorKind: WorkflowActorKind,
): RequestWorkflowEvent {
  const internalActor = actorKind !== "COMPANY";
  return {
    id: event.id,
    eventKey: CUSTOMER_EVENT_KEYS.get(event.eventKey) ?? event.eventKey,
    ...(customerSafeState(event.previousState)
      ? { previousState: customerSafeState(event.previousState) }
      : {}),
    ...(customerSafeState(event.newState)
      ? { newState: customerSafeState(event.newState) }
      : {}),
    ...(!internalActor && event.reason ? { reason: event.reason } : {}),
    source: internalActor ? "SYSTEM" : event.source,
    ...(!internalActor && event.actorName ? { actorName: event.actorName } : {}),
    ...(!internalActor && event.actorRole ? { actorRole: event.actorRole } : {}),
    occurredAt: event.occurredAt,
    recordedAt: event.recordedAt,
  };
}

export const customerWorkflowPrivacyInternals = {
  customerSafeState,
  customerEventKey: (eventKey: string) => CUSTOMER_EVENT_KEYS.get(eventKey) ?? eventKey,
};
