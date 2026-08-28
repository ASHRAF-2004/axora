const IN_APP_ONLY_WORKFLOW_EVENTS = new Set([
  "company.created",
  "delivery.claimed",
  "delivery.assigned",
  "delivery.assignment_created",
  "delivery.accepted",
  "delivery.shopping_started",
  "delivery.items_acquired",
  "delivery.out_for_delivery",
  "delivery.en_route",
  "delivery.arrived",
  "delivery.partially_delivered",
  "delivery.delivered",
  "delivery.completed",
  "delivery.tracking_started",
  "delivery.tracking_paused",
  "delivery.tracking_resumed",
]);

export function workflowEventAllowsEmail(eventKey: string) {
  return !IN_APP_ONLY_WORKFLOW_EVENTS.has(eventKey);
}

export const workflowEmailPolicyInternals = { IN_APP_ONLY_WORKFLOW_EVENTS };
