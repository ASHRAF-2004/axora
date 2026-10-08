import { getSession, type SessionUser, type AuthenticatedSessionUser } from "./auth";
import { isDemoMode } from "./db";
import { canAccess } from "./permissions";
import { notificationSummary } from "./notification-repository";
import { getAvailableDeliveryJobs, getDriverDetailWorkspace, getDriverManagementWorkspace } from "./driver-operations";
import { getCompanyDeliveryTracking } from "./delivery-tracking";
import { getBudgetWorkspace } from "./budget-ledger";
import { getCompanyWalletWorkspace } from "./company-wallet";
import { customerCatalogLiveVersion } from "./repository";
import { requestLiveVersion } from "./request-reader";
import { getApprovalWorkspace } from "./request-approval";
import { getProcurementVarianceApprovalWorkspace } from "./budget-variance";
import { getCatalogPurchasingScope } from "./procurement-cart";
import { authoritativeSnapshotVersion, eventStreamsEnabled, snapshotEventStream } from "./server-event-stream";
import type { LiveContext, LiveSnapshot, LiveTopic } from "./live-update-contract";

function identityScope(actor: SessionUser) {
  return JSON.stringify([actor.id, actor.roleAssignmentId, actor.authVersion, actor.role,
    actor.accountKind, actor.scopeType, actor.isOwner,
    actor.companyId, actor.branchId, actor.departmentId, actor.supplierId,
    [...(actor.effectivePermissions ?? [])].sort()]);
}
function allowed(actor: SessionUser, topic: LiveTopic) {
  if (topic === "notifications") return true;
  if (topic === "jobs") return canAccess(actor, "view_delivery_portal");
  if (topic === "drivers" || topic === "driver") return canAccess(actor, "manage_deliveries");
  if (topic === "receiving") return canAccess(actor, "view_receiving") || canAccess(actor, "view_deliveries");
  if (topic === "budgets") return canAccess(actor, "view_budgets");
  if (topic === "wallet") return canAccess(actor, "view_wallet");
  if (topic === "requests") return canAccess(actor, "view_requests");
  if (topic === "approvals") return canAccess(actor, "view_approvals");
  return canAccess(actor, "view_catalog");
}

/** Ignore only transport metadata at the root, not business timestamps below it. */
function stableSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "capturedAt" && key !== "sequence"));
}

/** Demo budget periods synthesize these dates on each read; real dates are canonical. */
function versionSnapshot(topic: LiveTopic, value: unknown) {
  const snapshot = stableSnapshot(value);
  if (topic !== "budgets" || !isDemoMode() || !snapshot || typeof snapshot !== "object") return snapshot;
  const workspace = snapshot as { accounts?: Array<{ period?: Record<string, unknown> | null }> };
  if (!Array.isArray(workspace.accounts)) return snapshot;
  return { ...snapshot, accounts: workspace.accounts.map((account) => ({
    ...account,
    ...(typeof account.period?.id === "string" && account.period.id.startsWith("demo-period-") ? {
      period: Object.fromEntries(Object.entries(account.period).filter(([key]) => !["startsAt", "endsAt", "nextRefreshAt"].includes(key))),
    } : {}),
  })) };
}

function createAuthorization(opening: AuthenticatedSessionUser, topics: LiveTopic[], context: LiveContext = {}) {
  const openingScope = identityScope(opening);
  let actor = opening;
  const authorize = async () => {
    const current = await getSession();
    if (!current || identityScope(current) !== openingScope || topics.some((topic) => !allowed(current, topic))) throw new Error("Live authorization unavailable");
    if (topics.includes("catalog") && current.accountKind === "COMPANY"
      && (!context.branchId || !await getCatalogPurchasingScope(current, context.branchId))) throw new Error("Live context unavailable");
    actor = current;
  };
  return { authorize, current: () => actor };
}

export function authorizedLiveSnapshotStream(request: Request, opening: AuthenticatedSessionUser, topic: LiveTopic, load: (actor: AuthenticatedSessionUser) => Promise<unknown>, interval = 10_000) {
  const guard = createAuthorization(opening, [topic]);
  return snapshotEventStream(request, () => load(guard.current()), interval, {
    authorize: guard.authorize,
    version: (value) => authoritativeSnapshotVersion(stableSnapshot(value)),
    connectionScope: `${opening.id}:${opening.roleAssignmentId ?? opening.role}`,
  });
}

export function createLiveReader(opening: AuthenticatedSessionUser, topics: LiveTopic[], context: LiveContext) {
  const guard = createAuthorization(opening, topics, context);
  const authorize = guard.authorize;
  const load = async (): Promise<LiveSnapshot> => {
    const hints: LiveSnapshot["topics"] = {};
    // Serialize topic reads too: no parallel per-browser DB pressure.
    for (const topic of topics) {
      await authorize();
      const actor = guard.current();
      let value: unknown;
      if (topic === "notifications") {
        const summary = await notificationSummary(actor);
        hints.notifications = { version: authoritativeSnapshotVersion(summary.versionToken), unreadCount: summary.unreadCount };
        continue;
      }
      if (topic === "jobs") value = await getAvailableDeliveryJobs(actor);
      else if (topic === "drivers") value = await getDriverManagementWorkspace(actor);
      else if (topic === "driver") value = await getDriverDetailWorkspace(actor, context.driverId!);
      else if (topic === "receiving") value = await getCompanyDeliveryTracking(actor);
      else if (topic === "budgets") value = await getBudgetWorkspace(actor);
      else if (topic === "wallet") value = await getCompanyWalletWorkspace(actor, context.companyId);
      else if (topic === "requests") value = await requestLiveVersion(actor);
      else if (topic === "approvals") value = {
        approvals: actor.accountKind === "COMPANY" ? stableSnapshot(await getApprovalWorkspace(actor)) : null,
        variance: stableSnapshot(await getProcurementVarianceApprovalWorkspace(actor)),
      };
      else if (topic === "catalog") value = await customerCatalogLiveVersion(actor, context.branchId);
      if (value === null || value === undefined) throw new Error("Live context unavailable");
      const snapshot = versionSnapshot(topic, value);
      if (Buffer.byteLength(JSON.stringify(snapshot)) > 64 * 1024) throw new Error("Live snapshot unavailable");
      hints[topic] = { version: authoritativeSnapshotVersion(snapshot) };
    }
    return { topics: hints, streamEnabled: eventStreamsEnabled() };
  };
  return { authorize, load };
}

export const liveUpdateReaderInternals = { identityScope, allowed, stableSnapshot };
