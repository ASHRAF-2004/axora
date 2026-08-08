import type {
  CompanyDashboardData,
  PlatformDashboardData,
  ProcurementRequest,
} from "@/lib/types";
import type { SessionUser } from "@/lib/auth";

const CLOSED_REQUEST_STATUSES = new Set([
  "CANCELLED", "COMPLETED", "DELIVERED", "REJECTED",
  "Cancelled", "Completed", "Delivered", "Rejected",
]);

function textField(record: ProcurementRequest, ...keys: string[]): string {
  const value = record as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (typeof value[key] === "string") return String(value[key]);
  }
  return "";
}

export function isPlatformAnalyticsActor(actor: SessionUser): boolean {
  return actor.isOwner === true
    && actor.accountKind === "PLATFORM"
    && actor.scopeType === "PLATFORM"
    && actor.role === "PLATFORM_OWNER";
}

export function buildCompanyDashboardData(requests: ProcurementRequest[]): CompanyDashboardData {
  const byStatusMap = new Map<string, number>();
  for (const request of requests) {
    const status = textField(request, "status") || "UNKNOWN";
    byStatusMap.set(status, (byStatusMap.get(status) ?? 0) + 1);
  }

  const open = requests.filter((request) => !CLOSED_REQUEST_STATUSES.has(textField(request, "status")));
  const urgent = requests.filter((request) => {
    const priority = textField(request, "urgency", "priority").toUpperCase();
    return priority === "URGENT" || priority === "HIGH";
  });
  const today = new Date().toISOString().slice(0, 10);
  const attention = requests.filter((request) => request.urgency === "Urgent"
    || (request.neededByDate < today && !["Completed", "Cancelled"].includes(request.status))
    || request.lines.some((line) => ["Delayed", "Partially Delivered", "Failed"].includes(line.deliveryStatus))
    || (request.invoiceStatus && ["Issued", "Disputed"].includes(request.invoiceStatus)
      && request.paymentStatus !== "Paid")).slice(0, 6);

  return {
    scope: "company",
    requestCount: requests.length,
    openRequestCount: open.length,
    urgentRequestCount: urgent.length,
    byStatus: [...byStatusMap.entries()].map(([label, value]) => ({ label, value })),
    attention,
  };
}

export function platformDashboardData(
  data: Omit<PlatformDashboardData, "scope">,
): PlatformDashboardData {
  return { scope: "platform", ...data };
}
