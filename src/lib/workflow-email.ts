import type { PoolClient } from "pg";
import { isDemoMode, withAuditTransaction } from "./db";
import { normalizeEmailCompletionProviderName } from "./email-completion-provider";
import type { TransactionalEmailOutcome } from "./transactional-email";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EVENT_KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,119}$/;
const OUTBOX_LEASE_SECONDS = 90;
const OUTBOX_MAX_ATTEMPTS = 7;

export interface WorkflowEmailDraft {
  companyId: string;
  recipientUserId: string;
  workflowEventId: string;
  eventKey: string;
  dedupeKey: string;
  title: string;
  body: string;
  routePath?: string;
}

export interface WorkflowEmailOutboxJob {
  deliveryId: string;
  leaseId: string;
  messageKind: "WORKFLOW_UPDATE";
  locale: "en" | "ar" | "ms";
  recipientEmail: string;
  recipientName: string;
  eventKey: string;
  templateKey: string;
  templateVersion: number;
  priority: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  providerAgent: string;
  workflow: {
    title: string;
    body: string;
    actionPath?: string;
  };
}

function boundedText(value: string, maximum: number) {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum
    || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("Workflow email content is invalid.");
  }
  return normalized;
}

function safeRoutePath(value: string | undefined) {
  if (value === undefined) return undefined;
  if (value.length > 500 || !value.startsWith("/")
    || value.startsWith("//") || value.includes("://") || value.includes("#")
    || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error("Workflow email route is invalid.");
  }
  return value;
}

function validateDraft(input: WorkflowEmailDraft): WorkflowEmailDraft {
  for (const value of [input.companyId, input.recipientUserId, input.workflowEventId]) {
    if (!UUID_PATTERN.test(value)) throw new Error("Workflow email scope is invalid.");
  }
  if (!EVENT_KEY_PATTERN.test(input.eventKey)
    || input.dedupeKey.length < 8 || input.dedupeKey.length > 200
    || /[\u0000-\u001f\u007f]/.test(input.dedupeKey)) {
    throw new Error("Workflow email identity is invalid.");
  }
  return {
    ...input,
    title: boundedText(input.title, 180),
    body: boundedText(input.body, 2_000),
    ...(input.routePath ? { routePath: safeRoutePath(input.routePath) } : {}),
  };
}

/**
 * Enqueue through the database capability boundary. The function independently
 * rechecks tenant scope, verified recipient state, and email preferences.
 */
export async function enqueueWorkflowEmail(
  client: PoolClient,
  input: WorkflowEmailDraft,
) {
  const draft = validateDraft(input);
  const result = await client.query<{ id?: string }>(`
    SELECT axora_enqueue_workflow_email(
      $1,$2,$3,$4,$5,$6,$7,$8
    )::text AS id
  `, [
    draft.companyId,
    draft.workflowEventId,
    draft.recipientUserId,
    draft.eventKey,
    draft.dedupeKey,
    draft.title,
    draft.body,
    draft.routePath ?? null,
  ]);
  return Boolean(result.rows[0]?.id);
}

interface ClaimedWorkflowEmailRow {
  deliveryId: string;
  leaseId: string;
  locale: string;
  recipientEmail: string;
  recipientName: string;
  title: string;
  body: string;
  routePath?: string;
  eventKey?: string;
  templateKey?: string;
  templateVersion?: number;
  priority?: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  providerAgent?: string;
}

function claimedJob(row: ClaimedWorkflowEmailRow): WorkflowEmailOutboxJob {
  const eventKey = row.eventKey ?? "workflow.update";
  const templateKey = row.templateKey ?? "workflow-update";
  const templateVersion = row.templateVersion ?? 1;
  const priority = row.priority ?? "NORMAL";
  const providerAgent = row.providerAgent ?? "axora-platform";
  if (!UUID_PATTERN.test(row.deliveryId) || !UUID_PATTERN.test(row.leaseId)
    || !["en", "ar", "ms"].includes(row.locale)
    || row.recipientEmail.length > 254 || !EMAIL_PATTERN.test(row.recipientEmail)
    || /[\r\n]/.test(row.recipientEmail)
    || !EVENT_KEY_PATTERN.test(eventKey)
    || !/^[a-z][a-z0-9-]{1,119}$/.test(templateKey)
    || !Number.isInteger(templateVersion) || templateVersion < 1
    || !["LOW", "NORMAL", "HIGH", "URGENT"].includes(priority)
    || !["axora-auth", "axora-procurement", "axora-budget", "axora-delivery", "axora-documents", "axora-platform"].includes(providerAgent)) {
    throw new Error("The workflow email outbox returned an invalid job.");
  }
  const actionPath = safeRoutePath(row.routePath);
  return {
    deliveryId: row.deliveryId,
    leaseId: row.leaseId,
    messageKind: "WORKFLOW_UPDATE",
    locale: row.locale as WorkflowEmailOutboxJob["locale"],
    recipientEmail: row.recipientEmail.toLowerCase(),
    recipientName: boundedText(row.recipientName, 200),
    eventKey,
    templateKey,
    templateVersion,
    priority,
    providerAgent,
    workflow: {
      title: boundedText(row.title, 180),
      body: boundedText(row.body, 2_000),
      ...(actionPath ? { actionPath } : {}),
    },
  };
}

export async function claimWorkflowEmailOutbox(): Promise<WorkflowEmailOutboxJob | null> {
  if (isDemoMode()) return null;
  return withAuditTransaction(
    { reason: "Workflow email claimed" },
    async (client) => {
      const result = await client.query<ClaimedWorkflowEmailRow>(`
        SELECT delivery_id::text AS "deliveryId",lease_id::text AS "leaseId",
          locale,recipient_email AS "recipientEmail",
          recipient_name AS "recipientName",title,body,
          route_path AS "routePath",
        event_key AS "eventKey",template_key AS "templateKey",
          template_version AS "templateVersion",priority,
          provider_agent AS "providerAgent"
        FROM axora_claim_workflow_email_v2($1,$2)
      `, [OUTBOX_LEASE_SECONDS, OUTBOX_MAX_ATTEMPTS]);
      return result.rows[0] ? claimedJob(result.rows[0]) : null;
    },
  );
}

function safeErrorCode(value: string | undefined) {
  if (value === undefined) return null;
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9_]{1,64}$/.test(normalized)) {
    throw new Error("The workflow email error code is invalid.");
  }
  return normalized;
}

function safeProviderMessageId(value: string | undefined) {
  const normalized = value?.trim();
  if (normalized && (normalized.length > 255 || /[\r\n]/.test(normalized))) {
    throw new Error("The email provider message identifier is invalid.");
  }
  return normalized || null;
}

function safeProviderName(value: string | undefined) {
  return normalizeEmailCompletionProviderName(
    value,
    "The workflow email provider is invalid.",
  );
}

function safeProviderAgent(value: string | undefined) {
  if (value === undefined) return null;
  const normalized = value.trim();
  if (!["axora-auth", "axora-procurement", "axora-budget", "axora-delivery", "axora-documents", "axora-platform"].includes(normalized)) {
    throw new Error("The workflow email Agent is invalid.");
  }
  return normalized;
}

function safeHttpStatus(value: number | undefined) {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 100 || value > 599) {
    throw new Error("The workflow email provider status is invalid.");
  }
  return value;
}

export async function completeWorkflowEmailOutbox(
  deliveryId: string,
  leaseId: string,
  outcome: TransactionalEmailOutcome,
  details: {
    providerMessageId?: string;
    errorCode?: string;
    providerName?: string;
    providerAgent?: string;
    httpStatus?: number;
  } = {},
) {
  if (isDemoMode()) return false;
  if (!UUID_PATTERN.test(deliveryId) || !UUID_PATTERN.test(leaseId)) {
    throw new Error("The workflow email lease is invalid.");
  }
  const providerMessageId = safeProviderMessageId(details.providerMessageId);
  const errorCode = safeErrorCode(details.errorCode);
  const providerName = safeProviderName(details.providerName);
  const providerAgent = safeProviderAgent(details.providerAgent);
  const httpStatus = safeHttpStatus(details.httpStatus);
  if (outcome === "sent" && errorCode) {
    throw new Error("A successful workflow email cannot contain an error code.");
  }
  return withAuditTransaction(
    { reason: `Workflow email ${outcome}` },
    async (client) => {
      const result = await client.query<{ recorded: boolean }>(`
        SELECT axora_complete_workflow_email_v2(
          $1,$2,$3,$4,$5,$6,$7,$8,$9
        ) AS recorded
      `, [
        deliveryId,
        leaseId,
        outcome,
        providerMessageId,
        errorCode,
        OUTBOX_MAX_ATTEMPTS,
        providerName,
        providerAgent,
        httpStatus,
      ]);
      return result.rows[0]?.recorded === true;
    },
  );
}

export const workflowEmailInternals = {
  claimedJob,
  safeRoutePath,
  validateDraft,
};
