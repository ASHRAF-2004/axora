import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { SessionUser } from "./auth";
import { isDemoMode, withAuditTransaction } from "./db";
import {
  buildInAppNotification,
  resolveNotificationPreference,
  type NotificationPriority,
} from "./notifications";
import { canAccess } from "./permissions";
import { enqueueWorkflowEmail } from "./workflow-email";
import {
  renderWorkflowNotification,
  type WorkflowNotificationMessage,
} from "./workflow-notification-i18n";
import {
  buildWorkflowEvent,
  workflowIdempotencyKey,
  type WorkflowActorKind,
  type WorkflowJson,
  type WorkflowMetadata,
} from "./workflow-events";

type WorkflowActor = Pick<SessionUser,
  "id" | "role" | "accountKind" | "isOwner" | "companyId" | "branchId" | "departmentId"
>;

export type WorkflowAudience =
  | "REQUEST_APPROVERS"
  | "REQUEST_CREATOR"
  | "PLATFORM_OPERATIONS"
  | "COMPANY_RECEIVERS"
  | "COMPANY_FINANCE";

export interface AppendWorkflowEventInput {
  companyId: string;
  branchId?: string;
  requestId?: string;
  aggregateType: string;
  aggregateId: string;
  eventKey: string;
  stableKey: string;
  actor: WorkflowActor;
  previousState?: string;
  newState?: string;
  reason?: string;
  source: "WEB" | "SUPPLIER_PORTAL" | "DELIVERY_PORTAL" | "SYSTEM";
  metadata?: WorkflowMetadata;
}

export interface PersistedWorkflowEvent {
  id: string;
  companyId: string;
  branchId?: string;
  requestId?: string;
  aggregateType: string;
  aggregateId: string;
  eventKey: string;
  eventVersion: number;
  correlationId: string;
  occurredAt: string;
  created: boolean;
}

export interface RequestWorkflowEvent {
  id: string;
  eventKey: string;
  previousState?: string;
  newState?: string;
  reason?: string;
  source: string;
  actorName?: string;
  actorRole?: string;
  occurredAt: string;
  recordedAt: string;
}

function actorKind(actor: WorkflowActor): WorkflowActorKind {
  if (actor.accountKind === "PLATFORM" || actor.isOwner) return "PLATFORM";
  if (actor.accountKind === "SUPPLIER") return "SUPPLIER";
  if (actor.accountKind === "DELIVERY") return "DELIVERY";
  return "COMPANY";
}

function safeState(value: string | undefined) {
  const result = value?.trim();
  return result ? result.slice(0, 160) : undefined;
}

function eventMetadata(input: AppendWorkflowEventInput): WorkflowMetadata {
  const extra = input.metadata ?? {};
  const result: WorkflowMetadata = {
    ...extra,
    actorRole: String(input.actor.role).slice(0, 80),
    source: input.source,
  };
  const previousState = safeState(input.previousState);
  const newState = safeState(input.newState);
  const reason = input.reason?.trim().slice(0, 1_000);
  if (previousState) result.previousState = previousState;
  if (newState) result.newState = newState;
  if (reason) result.reason = reason;
  return result;
}

export async function appendWorkflowEvent(
  client: PoolClient,
  input: AppendWorkflowEventInput,
): Promise<PersistedWorkflowEvent> {
  const idempotencyKey = workflowIdempotencyKey(
    input.eventKey,
    input.aggregateId,
    input.stableKey,
  );
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
    [`${input.companyId}:${input.aggregateType}:${input.aggregateId}`],
  );
  const existing = await client.query<Omit<PersistedWorkflowEvent, "created">>(`
    SELECT id::text,company_id::text AS "companyId",branch_id::text AS "branchId",
      request_id::text AS "requestId",aggregate_type AS "aggregateType",
      aggregate_id::text AS "aggregateId",event_key AS "eventKey",
      event_version AS "eventVersion",correlation_id::text AS "correlationId",
      occurred_at::text AS "occurredAt"
    FROM workflow_events WHERE company_id=$1 AND idempotency_key=$2
  `, [input.companyId, idempotencyKey]);
  if (existing.rows[0]) return { ...existing.rows[0], created: false };

  const version = await client.query<{ nextVersion: number }>(`
    SELECT COALESCE(max(event_version),0)::int+1 AS "nextVersion"
    FROM workflow_events
    WHERE company_id=$1 AND aggregate_type=$2 AND aggregate_id=$3
  `, [input.companyId, input.aggregateType, input.aggregateId]);
  const draft = buildWorkflowEvent({
    companyId: input.companyId,
    branchId: input.branchId,
    requestId: input.requestId,
    aggregateType: input.aggregateType,
    aggregateId: input.aggregateId,
    eventKey: input.eventKey,
    eventVersion: Number(version.rows[0]?.nextVersion ?? 1),
    actorUserId: input.actor.id,
    actorKind: actorKind(input.actor),
    correlationId: input.requestId ?? input.aggregateId,
    idempotencyKey,
    metadata: eventMetadata(input),
  });
  await client.query(`
    INSERT INTO workflow_events(
      id,company_id,branch_id,request_id,aggregate_type,aggregate_id,event_key,
      event_version,actor_user_id,actor_kind,correlation_id,causation_event_id,
      idempotency_key,occurred_at,metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
  `, [draft.id,draft.companyId,draft.branchId ?? null,draft.requestId ?? null,
    draft.aggregateType,draft.aggregateId,draft.eventKey,draft.eventVersion,
    draft.actorUserId ?? null,draft.actorKind,draft.correlationId,
    draft.causationEventId ?? null,draft.idempotencyKey,draft.occurredAt,draft.metadata]);
  return { ...draft, created: true };
}

async function recipientsForAudience(
  client: PoolClient,
  event: PersistedWorkflowEvent,
  audiences: readonly WorkflowAudience[],
  actorUserId: string,
) {
  const recipientIds = new Set<string>();
  for (const audience of audiences) {
    if (audience === "REQUEST_CREATOR" && event.requestId) {
      const result = await client.query<{ id: string }>(`
        SELECT created_by::text AS id FROM requests
        WHERE id=$1 AND company_id=$2 AND created_by IS NOT NULL
      `, [event.requestId, event.companyId]);
      result.rows.forEach((row) => recipientIds.add(row.id));
      continue;
    }
    if (audience === "PLATFORM_OPERATIONS") {
      const result = await client.query<{ id: string }>(`
        SELECT DISTINCT account.id::text AS id
        FROM users account
        LEFT JOIN role_assignments assignment ON assignment.user_id=account.id
          AND assignment.active AND assignment.revoked_at IS NULL
        LEFT JOIN roles role ON role.id=assignment.role_id
        WHERE account.active AND account.account_status='ACTIVE'
          AND account.account_kind='PLATFORM'
          AND (account.is_owner OR role.role_key IN ('PLATFORM_OWNER','PLATFORM_OPERATIONS'))
      `);
      result.rows.forEach((row) => recipientIds.add(row.id));
      continue;
    }
    const roleKeys = audience === "REQUEST_APPROVERS"
      ? ["COMPANY_ADMIN", "COMPANY_APPROVER", "BRANCH_APPROVER", "ADMIN", "BRANCH_ADMIN", "APPROVER"]
      : audience === "COMPANY_RECEIVERS"
        ? ["RECEIVING_USER", "COMPANY_ADMIN", "ADMIN"]
        : ["FINANCE_REVIEWER", "COMPANY_ADMIN", "FINANCE", "ADMIN"];
    const result = await client.query<{ id: string }>(`
      SELECT DISTINCT account.id::text AS id
      FROM users account
      JOIN company_memberships membership ON membership.user_id=account.id
        AND membership.company_id=$1 AND membership.status='ACTIVE'
      JOIN role_assignments assignment ON assignment.user_id=account.id
        AND assignment.company_id=$1 AND assignment.active
        AND assignment.revoked_at IS NULL
      JOIN roles role ON role.id=assignment.role_id
      WHERE account.active AND account.account_status='ACTIVE'
        AND role.role_key=ANY($2::text[])
        AND (assignment.scope_type='COMPANY'
          OR (assignment.scope_type='BRANCH' AND assignment.branch_id=$3))
    `, [event.companyId, roleKeys, event.branchId ?? null]);
    result.rows.forEach((row) => recipientIds.add(row.id));
  }
  recipientIds.delete(actorUserId);
  return [...recipientIds];
}

export async function notifyWorkflowAudience(
  client: PoolClient,
  event: PersistedWorkflowEvent,
  input: {
    actorUserId: string;
    audiences: readonly WorkflowAudience[];
    message: WorkflowNotificationMessage;
    routePath?: string;
    priority?: NotificationPriority;
  },
) {
  if (!event.created) return 0;
  const recipients = await recipientsForAudience(
    client,
    event,
    input.audiences,
    input.actorUserId,
  );
  return notifyWorkflowUsers(client, event, {
    recipientUserIds: recipients,
    message: input.message,
    routePath: input.routePath,
    priority: input.priority,
  });
}

export async function notifyWorkflowUsers(
  client: PoolClient,
  event: PersistedWorkflowEvent,
  input: {
    recipientUserIds: readonly string[];
    message: WorkflowNotificationMessage;
    routePath?: string;
    priority?: NotificationPriority;
  },
) {
  if (!event.created) return 0;
  let inserted = 0;
  for (const recipientUserId of new Set(input.recipientUserIds)) {
    const preference = await client.query<{
      globalInAppEnabled: boolean;
      globalEmailEnabled: boolean;
      eventPreferenceExists: boolean;
      eventInAppEnabled: boolean;
      eventEmailEnabled: boolean;
      digestMode: "IMMEDIATE" | "DAILY" | "WEEKLY";
      mutedUntil?: string;
      recipientLocale: string;
    }>(`
      SELECT global_in_app_enabled AS "globalInAppEnabled",
        global_email_enabled AS "globalEmailEnabled",
        event_preference_exists AS "eventPreferenceExists",
        event_in_app_enabled AS "eventInAppEnabled",
        event_email_enabled AS "eventEmailEnabled",
        delivery_schedule AS "digestMode",
        muted_until::text AS "mutedUntil",
        recipient_locale AS "recipientLocale"
      FROM axora_workflow_notification_preference($1,$2,$3,$4)
    `, [event.companyId, event.id, recipientUserId, event.eventKey]);
    const saved = preference.rows[0];
    if (!saved) continue;
    const effective = resolveNotificationPreference(
      {
        inAppEnabled: saved.globalInAppEnabled,
        emailEnabled: saved.globalEmailEnabled,
      },
      saved.eventPreferenceExists ? {
        eventKey: event.eventKey,
        inAppEnabled: saved.eventInAppEnabled,
        emailEnabled: saved.eventEmailEnabled,
        digestMode: saved.digestMode,
        ...(saved.mutedUntil ? { mutedUntil: saved.mutedUntil } : {}),
      } : undefined,
    );
    const content = renderWorkflowNotification(input.message, saved.recipientLocale);
    const draft = buildInAppNotification({
      id: randomUUID(),
      companyId: event.companyId,
      recipientUserId,
      workflowEventId: event.id,
      eventKey: event.eventKey,
      title: content.title,
      body: content.body,
      routePath: input.routePath,
      priority: input.priority,
    });
    if (effective.inAppEnabled) {
      const result = await client.query(`
        INSERT INTO in_app_notifications(
          id,company_id,recipient_user_id,workflow_event_id,event_key,dedupe_key,
          title,body,priority,route_path,created_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(company_id,recipient_user_id,dedupe_key) DO NOTHING
      `, [draft.id,draft.companyId,draft.recipientUserId,draft.workflowEventId,
        draft.eventKey,draft.dedupeKey,draft.title,draft.body,draft.priority,
        draft.routePath ?? null,draft.createdAt]);
      inserted += result.rowCount ?? 0;
    }
    if (effective.emailEnabled) {
      await enqueueWorkflowEmail(client, {
        companyId: draft.companyId,
        recipientUserId: draft.recipientUserId,
        workflowEventId: draft.workflowEventId,
        eventKey: draft.eventKey,
        dedupeKey: draft.dedupeKey,
        title: draft.title,
        body: draft.body,
        ...(draft.routePath ? { routePath: draft.routePath } : {}),
      });
    }
  }
  return inserted;
}

function metadataText(metadata: unknown, key: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const value = (metadata as Record<string, WorkflowJson>)[key];
  return typeof value === "string" ? value : undefined;
}

function customerVisibleActorName(actorKind: WorkflowActorKind, actorName: string | undefined) {
  return actorKind === "SUPPLIER" ? undefined : actorName;
}

export async function listRequestWorkflowEvents(
  actor: SessionUser,
  requestId: string,
): Promise<RequestWorkflowEvent[]> {
  if (!canAccess(actor, "view_requests")) throw new Error("Your account cannot view this request timeline.");
  if (isDemoMode()) return [];
  return withAuditTransaction(
    { userId: actor.id, reason: "Viewed request workflow timeline" },
    async (client) => {
      const result = await client.query<{
        id: string;
        eventKey: string;
        actorKind: WorkflowActorKind;
        actorName?: string;
        occurredAt: string;
        recordedAt: string;
        metadata: WorkflowMetadata;
      }>(`
        SELECT event.id::text,event.event_key AS "eventKey",event.actor_kind AS "actorKind",
          profile.display_name AS "actorName",event.occurred_at::text AS "occurredAt",
          event.recorded_at::text AS "recordedAt",event.metadata
        FROM workflow_events event
        LEFT JOIN user_profiles profile ON profile.user_id=event.actor_user_id
        WHERE event.request_id=$1
        ORDER BY event.occurred_at,event.event_version,event.id
      `, [requestId]);
      return result.rows.map((row) => ({
        id: row.id,
        eventKey: row.eventKey,
        ...(metadataText(row.metadata, "previousState") ? { previousState: metadataText(row.metadata, "previousState") } : {}),
        ...(metadataText(row.metadata, "newState") ? { newState: metadataText(row.metadata, "newState") } : {}),
        ...(metadataText(row.metadata, "reason") ? { reason: metadataText(row.metadata, "reason") } : {}),
        source: metadataText(row.metadata, "source") ?? "SYSTEM",
        ...(customerVisibleActorName(row.actorKind, row.actorName) ? { actorName: row.actorName } : {}),
        ...(metadataText(row.metadata, "actorRole") ? { actorRole: metadataText(row.metadata, "actorRole") } : {}),
        occurredAt: row.occurredAt,
        recordedAt: row.recordedAt,
      }));
    },
  );
}

export const workflowRepositoryInternals = { actorKind, eventMetadata, customerVisibleActorName };
