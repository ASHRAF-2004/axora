import type { SessionUser } from "./auth";
import { isDemoMode, withAuditTransaction } from "./db";
import { canAccess } from "./permissions";
import { z } from "zod";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^20\d{2}-\d{2}-\d{2}$/;
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{1,119}$/;
const ERROR_PATTERN = /^[a-z0-9_]{1,64}$/;
const DOMAIN_PATTERN = /^[a-z0-9.-]{3,253}$/;
const RESEND_QUOTA_MAXIMUM = 1_000_000_000;

export const resendQuotaSnapshotSchema = z.object({
  provider: z.literal("resend"),
  plan: z.enum(["FREE", "PAID"]),
  monthlyUsed: z.number().int().min(0).max(RESEND_QUOTA_MAXIMUM),
  monthlyLimit: z.number().int().min(1).max(RESEND_QUOTA_MAXIMUM),
  dailyUsed: z.number().int().min(0).max(RESEND_QUOTA_MAXIMUM).nullable(),
  dailyLimit: z.number().int().min(1).max(RESEND_QUOTA_MAXIMUM).nullable(),
  source: z.enum(["PROVIDER_RESPONSE_HEADER", "PROVIDER_READ_ONLY_SYNC"]),
  responseStatusClass: z.number().int().min(2).max(5),
  capturedAt: z.iso.datetime({ offset: true }),
}).superRefine((snapshot, context) => {
  if ((snapshot.dailyUsed === null) !== (snapshot.dailyLimit === null)
    || (snapshot.plan === "FREE" && snapshot.dailyLimit === null)) {
    context.addIssue({ code: "custom", message: "Invalid daily quota shape" });
  }
});

export type ResendQuotaSnapshot = z.infer<typeof resendQuotaSnapshotSchema>;

function configuredQuotaLimit(value: string | undefined) {
  if (!/^[1-9][0-9]*$/.test(value ?? "")) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= RESEND_QUOTA_MAXIMUM
    ? parsed : undefined;
}

export function resendPlanConfiguration(
  env: Record<string, string | undefined> = process.env,
) {
  const plan = (env.AXORA_RESEND_PLAN ?? "FREE").trim().toUpperCase();
  const monthlyLimit = configuredQuotaLimit(
    env.AXORA_RESEND_MONTHLY_LIMIT ?? "3000",
  );
  const dailyRaw = (env.AXORA_RESEND_DAILY_LIMIT
    ?? (plan === "FREE" ? "100" : "")).trim();
  const dailyLimit = dailyRaw ? configuredQuotaLimit(dailyRaw) : undefined;
  if ((plan !== "FREE" && plan !== "PAID") || monthlyLimit === undefined
    || (plan === "FREE" && dailyLimit === undefined)) {
    throw new Error("email_operations_unavailable");
  }
  return { plan, monthlyLimit, dailyLimit } as const;
}

/** Logical Axora queue streams. These are not external-provider accounts. */
export const EMAIL_DELIVERY_STREAMS = [
  "axora-auth",
  "axora-procurement",
  "axora-budget",
  "axora-delivery",
  "axora-documents",
  "axora-platform",
] as const;

export const EMAIL_DELIVERY_STATUSES = [
  "PENDING",
  "SENDING",
  "SENT",
  "FAILED",
  "DISABLED",
  "UNCERTAIN",
  "CANCELLED",
] as const;

export type EmailDeliveryStream = (typeof EMAIL_DELIVERY_STREAMS)[number];
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];
export type EmailDeliveryKind = "ACCOUNT_SETUP" | "TRANSACTIONAL" | "WORKFLOW";

export interface EmailOperationsFilters {
  from?: string;
  to?: string;
  agent?: EmailDeliveryStream;
  event?: string;
  template?: string;
  status?: EmailDeliveryStatus;
  companyId?: string;
  domain?: string;
  error?: string;
  correlation?: string;
  entity?: string;
  offset?: string;
}

export interface EmailOperationsRecord {
  deliveryKind: EmailDeliveryKind;
  deliveryId: string;
  companyId?: string;
  entityId?: string;
  entityType?: string;
  eventKey: string;
  templateKey: string;
  templateVersion: number;
  priority: string;
  providerAgent: EmailDeliveryStream;
  status: EmailDeliveryStatus;
  attemptCount: number;
  maximumAttempts: number;
  availableAt: string;
  attemptedAt?: string;
  sentAt?: string;
  createdAt: string;
  maskedRecipient: string;
  recipientDomain?: string;
  recipientSuppressed: boolean;
  providerName?: string;
  attemptOutcome?: string;
  providerStatus?: string;
  providerStatusAt?: string;
  lastError?: string;
  httpStatus?: number;
  correlationId: string;
  routePath?: string;
  retryable: boolean;
  cancellable: boolean;
  resendable: boolean;
  canReveal: boolean;
}

export interface EmailStreamSummary {
  providerAgent: EmailDeliveryStream;
  paused: boolean;
  changedAt: string;
  revision: number;
  queueDepth: number;
  retrying: number;
  failures: number;
  oldestQueuedAt?: string;
}

/** Current provider health deliberately excludes provider-credit semantics. */
export interface EmailProviderHealth {
  providerName?: string;
  source: "SUPPORTED_API" | "MANUAL" | "MISSING";
  accountState: string;
  domainName?: string;
  domainState: string;
  configurationState: string;
  lastProviderSubmissionAt?: string;
  lastProviderWebhookAt?: string;
  capturedAt?: string;
}

export type EmailProviderRuntimeState =
  | "DELIVERY_DISABLED"
  | "SIGNED_WEBHOOK_CONFIGURED"
  | "READY_FOR_CONTROLLED_SEND"
  | "FULLY_ENABLED"
  | "MISCONFIGURED";

export interface EmailProviderRuntimeReadiness {
  providerName: string;
  state: EmailProviderRuntimeState;
  deliveryEnabled: boolean;
  eventsEnabled: boolean;
  domainVerified: boolean;
  webhookVerified: boolean;
}

export interface EmailOperationsWorkspace {
  capturedAt: string;
  canManage: boolean;
  totalRecords: number;
  metrics: {
    created: number;
    submitted: number;
    delivered: number;
    queueDepth: number;
    oldestQueuedAt?: string;
    retries: number;
    permanentFailures: number;
    softBounces: number;
    hardBounces: number;
    complaints: number;
    suppressedRecipients: number;
    invalidRecipients: number;
    dailyRecipientUnits: number;
    monthlyRecipientUnits: number;
    lastProviderSubmissionAt?: string;
    lastProviderWebhookAt?: string;
    webhookFailures: number;
  };
  records: EmailOperationsRecord[];
  agents: EmailStreamSummary[];
  dailyUsage: Array<{ day: string; recipientUnits: number; attempts: number }>;
  providerRuntime: EmailProviderRuntimeReadiness;
  providerHealth?: EmailProviderHealth;
  resendQuota?: ResendQuotaSnapshot;
  webhooks: Array<{
    providerName: string;
    periodStart: string;
    accepted: number;
    rejected: number;
    processingFailures: number;
    lastErrorCode?: string;
    lastEventAt: string;
  }>;
  suppressions: Array<{
    source: "OPERATOR" | "PROVIDER";
    targetType: "ADDRESS" | "DOMAIN";
    maskedTarget: string;
    action: "SUPPRESS" | "UNSUPPRESS";
    correctionResolved: boolean;
    occurredAt: string;
  }>;
  companies: Array<{ id: string; name: string }>;
}

export type EmailOperationsCommandAction =
  | "RETRY"
  | "CANCEL"
  | "RESEND"
  | "REVEAL"
  | "SUPPRESS"
  | "UNSUPPRESS"
  | "PAUSE_AGENT"
  | "RESUME_AGENT"
  | "RECONCILE"
  | "RECORD_PROVIDER_HEALTH";

export interface EmailOperationsCommand {
  commandId: string;
  action: EmailOperationsCommandAction;
  deliveryKind?: EmailDeliveryKind;
  deliveryId?: string;
  providerAgent?: EmailDeliveryStream;
  reason: string;
  details?: Record<string, unknown>;
}

const WORKSPACE_SQL = `
  SELECT public.axora_email_operations_snapshot($1::jsonb) AS workspace
`;

const COMMAND_SQL = `
  SELECT public.axora_email_operations_command(
    $1::uuid,$2::text,$3::text,$4::uuid,$5::text,$6::text,$7::jsonb
  ) AS result
`;

const WEBHOOK_FAILURE_SQL = `
  SELECT public.axora_record_email_webhook_failure($1::text,$2::text)
`;

const RESEND_QUOTA_READ_SQL = `
  SELECT public.axora_current_resend_quota_snapshot() AS snapshot
`;

const RESEND_QUOTA_WRITE_SQL = `
  SELECT public.axora_record_resend_quota_snapshot(
    $1::text,$2::bigint,$3::bigint,$4::bigint,$5::bigint,$6::text,
    $7::smallint,$8::timestamptz
  ) AS changed
`;

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function validDate(value: string | undefined) {
  if (!value || !DATE_PATTERN.test(value)) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime())
    || date.toISOString().slice(0, 10) !== value ? undefined : value;
}

function cleanKey(value: string | undefined) {
  const clean = value?.trim();
  return clean && KEY_PATTERN.test(clean) ? clean : undefined;
}

export function normalizeEmailOperationsFilters(
  input: Record<string, string | string[] | undefined>,
): EmailOperationsFilters {
  const from = validDate(first(input.from));
  const to = validDate(first(input.to));
  const streamValue = first(input.agent);
  const statusValue = first(input.status)?.toUpperCase();
  const companyId = first(input.companyId)?.trim().toLowerCase();
  const correlation = first(input.correlation)?.trim().toLowerCase();
  const domain = first(input.domain)?.trim().toLowerCase();
  const error = first(input.error)?.trim().toLowerCase();
  const entity = first(input.entity)?.trim();
  const offsetValue = first(input.offset)?.trim();
  const offset = offsetValue && /^\d{1,5}$/.test(offsetValue)
    ? String(Math.min(Number(offsetValue), 10_000)) : undefined;
  const event = cleanKey(first(input.event));
  const template = cleanKey(first(input.template));
  return {
    ...(from && to && from > to ? {} : { from, to }),
    ...(EMAIL_DELIVERY_STREAMS.includes(streamValue as EmailDeliveryStream)
      ? { agent: streamValue as EmailDeliveryStream } : {}),
    ...(EMAIL_DELIVERY_STATUSES.includes(statusValue as EmailDeliveryStatus)
      ? { status: statusValue as EmailDeliveryStatus } : {}),
    ...(companyId && UUID_PATTERN.test(companyId) ? { companyId } : {}),
    ...(correlation && UUID_PATTERN.test(correlation) ? { correlation } : {}),
    ...(domain && DOMAIN_PATTERN.test(domain) ? { domain } : {}),
    ...(error && ERROR_PATTERN.test(error) ? { error } : {}),
    ...(entity && entity.length <= 120
      && !/[\u0000-\u001f\u007f]/.test(entity) ? { entity } : {}),
    ...(event ? { event } : {}),
    ...(template ? { template } : {}),
    ...(offset ? { offset } : {}),
  };
}

export function maskEmailAddress(value: string) {
  const normalized = value.trim().toLowerCase();
  const separator = normalized.lastIndexOf("@");
  if (separator < 1 || separator === normalized.length - 1) {
    return "private operations recipient";
  }
  return `${normalized.slice(0, Math.min(2, separator))}***${normalized.slice(separator)}`;
}

export function emailProviderRuntimeReadiness(
  env: NodeJS.ProcessEnv = process.env,
): EmailProviderRuntimeReadiness {
  const providerName = env.AXORA_EMAIL_PROVIDER?.trim() || "unconfigured";
  const deliveryEnabled = env.AXORA_EMAIL_DELIVERY_ENABLED === "true";
  const eventsEnabled = env.AXORA_EMAIL_EVENTS_ENABLED === "true";
  const domainVerified = env.RESEND_DOMAIN_VERIFIED === "true";
  const webhookVerified = env.RESEND_WEBHOOK_VERIFIED === "true";
  const gatesReady = domainVerified && webhookVerified;
  const invalid = providerName !== "resend"
    || (deliveryEnabled && (!eventsEnabled || !gatesReady))
    || (webhookVerified && !eventsEnabled);
  let state: EmailProviderRuntimeState = "DELIVERY_DISABLED";
  if (invalid) state = "MISCONFIGURED";
  else if (deliveryEnabled) state = "FULLY_ENABLED";
  else if (eventsEnabled && !webhookVerified) state = "SIGNED_WEBHOOK_CONFIGURED";
  else if (eventsEnabled && gatesReady) state = "READY_FOR_CONTROLLED_SEND";
  return {
    providerName,
    state,
    deliveryEnabled,
    eventsEnabled,
    domainVerified,
    webhookVerified,
  };
}

function requireView(actor: SessionUser) {
  if (!canAccess(actor, "view_email_operations")) {
    throw new Error("email_operations_unavailable");
  }
}

function requireManage(actor: SessionUser) {
  if (!canAccess(actor, "manage_email_operations")) {
    throw new Error("email_operation_unavailable");
  }
}

function demoWorkspace(actor: SessionUser, filters: EmailOperationsFilters): EmailOperationsWorkspace {
  const now = new Date();
  const companyId = actor.companyId ?? "10000000-0000-4000-8000-000000000001";
  const canManage = canAccess(actor, "manage_email_operations");
  const sample: EmailOperationsRecord[] = [
    {
      deliveryKind: "WORKFLOW",
      deliveryId: "70000000-0000-4000-8000-000000000001",
      companyId,
      entityId: "30000000-0000-4000-8000-000000000001",
      entityType: "request",
      eventKey: "approval.company_required",
      templateKey: "company-approval-required",
      templateVersion: 2,
      priority: "URGENT",
      providerAgent: "axora-procurement",
      status: "PENDING",
      attemptCount: 1,
      maximumAttempts: 7,
      availableAt: new Date(now.getTime() + 300_000).toISOString(),
      attemptedAt: new Date(now.getTime() - 60_000).toISOString(),
      createdAt: new Date(now.getTime() - 600_000).toISOString(),
      maskedRecipient: "ap***@example.invalid",
      recipientDomain: "example.invalid",
      recipientSuppressed: false,
      providerName: "resend",
      attemptOutcome: "retry",
      lastError: "provider_rate_limited",
      correlationId: "71000000-0000-4000-8000-000000000001",
      routePath: "/approvals",
      retryable: true,
      cancellable: true,
      resendable: false,
      canReveal: canManage,
    },
    {
      deliveryKind: "TRANSACTIONAL",
      deliveryId: "70000000-0000-4000-8000-000000000002",
      entityId: "30000000-0000-4000-8000-000000000002",
      entityType: "account",
      eventKey: "password.changed",
      templateKey: "password-changed",
      templateVersion: 1,
      priority: "URGENT",
      providerAgent: "axora-auth",
      status: "SENT",
      attemptCount: 1,
      maximumAttempts: 7,
      availableAt: new Date(now.getTime() - 900_000).toISOString(),
      attemptedAt: new Date(now.getTime() - 850_000).toISOString(),
      sentAt: new Date(now.getTime() - 840_000).toISOString(),
      createdAt: new Date(now.getTime() - 900_000).toISOString(),
      maskedRecipient: "ow***@axora.invalid",
      recipientDomain: "axora.invalid",
      recipientSuppressed: false,
      providerName: "resend",
      attemptOutcome: "sent",
      providerStatus: "MESSAGE_DELIVERED",
      correlationId: "71000000-0000-4000-8000-000000000002",
      routePath: "/account",
      retryable: false,
      cancellable: false,
      resendable: false,
      canReveal: canManage,
    },
  ];
  const records = sample.filter((record) => (
    (!filters.agent || filters.agent === record.providerAgent)
    && (!filters.status || filters.status === record.status)
    && (!filters.companyId || filters.companyId === record.companyId)
    && (!filters.domain || filters.domain === record.recipientDomain)
    && (!filters.event || filters.event === record.eventKey)
    && (!filters.template || filters.template === record.templateKey)
    && (!filters.error || filters.error === record.lastError)
    && (!filters.correlation || filters.correlation === record.correlationId)
    && (!filters.entity || filters.entity === record.entityId
      || filters.entity === record.entityType)
  ));
  return {
    capturedAt: now.toISOString(),
    canManage,
    totalRecords: records.length,
    metrics: {
      created: records.length,
      submitted: 1,
      delivered: 1,
      queueDepth: records.filter((record) => record.status === "PENDING").length,
      oldestQueuedAt: records.find((record) => record.status === "PENDING")?.createdAt,
      retries: 1,
      permanentFailures: 0,
      softBounces: 0,
      hardBounces: 1,
      complaints: 0,
      suppressedRecipients: 1,
      invalidRecipients: 0,
      dailyRecipientUnits: 18,
      monthlyRecipientUnits: 312,
      lastProviderSubmissionAt: new Date(now.getTime() - 60_000).toISOString(),
      lastProviderWebhookAt: new Date(now.getTime() - 30_000).toISOString(),
      webhookFailures: 1,
    },
    records,
    agents: EMAIL_DELIVERY_STREAMS.map((providerAgent) => ({
      providerAgent,
      paused: providerAgent === "axora-documents",
      changedAt: new Date(now.getTime() - 3_600_000).toISOString(),
      revision: providerAgent === "axora-documents" ? 2 : 1,
      queueDepth: records.filter((record) => (
        record.providerAgent === providerAgent && record.status === "PENDING"
      )).length,
      retrying: records.filter((record) => (
        record.providerAgent === providerAgent && record.attemptCount > 0
      )).length,
      failures: 0,
    })),
    dailyUsage: [{ day: now.toISOString(), recipientUnits: 18, attempts: 19 }],
    providerRuntime: {
      providerName: "resend",
      state: "FULLY_ENABLED",
      deliveryEnabled: true,
      eventsEnabled: true,
      domainVerified: true,
      webhookVerified: true,
    },
    providerHealth: canManage ? {
      providerName: "resend",
      source: "MANUAL",
      accountState: "HEALTHY",
      domainName: "axora.management",
      domainState: "VERIFIED",
      configurationState: "HEALTHY",
      capturedAt: new Date(now.getTime() - 3_600_000).toISOString(),
    } : undefined,
    resendQuota: actor.isOwner && actor.accountKind === "PLATFORM"
      && process.env.AXORA_DEMO_RESEND_QUOTA_AVAILABLE !== "false" ? {
      provider: "resend",
      plan: "FREE",
      monthlyUsed: 8,
      monthlyLimit: 3_000,
      dailyUsed: 0,
      dailyLimit: 100,
      source: "PROVIDER_RESPONSE_HEADER",
      responseStatusClass: 2,
      capturedAt: new Date(now.getTime() - 60_000).toISOString(),
    } : undefined,
    webhooks: canManage ? [{
      providerName: "resend",
      periodStart: now.toISOString(),
      accepted: 18,
      rejected: 0,
      processingFailures: 1,
      lastErrorCode: "processing_failed",
      lastEventAt: new Date(now.getTime() - 30_000).toISOString(),
    }] : [],
    suppressions: [{
      source: "PROVIDER",
      targetType: "ADDRESS",
      maskedTarget: "ba***@example.invalid",
      action: "SUPPRESS",
      correctionResolved: false,
      occurredAt: new Date(now.getTime() - 86_400_000).toISOString(),
    }],
    companies: [{ id: companyId, name: "Safe sample company" }],
  };
}

export async function getEmailOperationsWorkspace(
  actor: SessionUser,
  rawFilters: Record<string, string | string[] | undefined>,
) {
  requireView(actor);
  const filters = normalizeEmailOperationsFilters(rawFilters);
  if (isDemoMode()) return demoWorkspace(actor, filters);
  const workspace = await withAuditTransaction(
    { actor, reason: "Email operations workspace viewed" },
    async (client) => {
      const query = await client.query<{ workspace: EmailOperationsWorkspace }>(
        WORKSPACE_SQL,
        [JSON.stringify(filters)],
      );
      if (!query.rows[0]?.workspace) {
        throw new Error("email_operations_unavailable");
      }
      if (!actor.isOwner || actor.accountKind !== "PLATFORM") {
        return query.rows[0].workspace;
      }
      const quotaQuery = await client.query<{ snapshot: unknown }>(RESEND_QUOTA_READ_SQL);
      const snapshot = resendQuotaSnapshotSchema.safeParse(quotaQuery.rows[0]?.snapshot);
      return {
        ...query.rows[0].workspace,
        ...(snapshot.success ? { resendQuota: snapshot.data } : {}),
      };
    },
  );
  return { ...workspace, providerRuntime: emailProviderRuntimeReadiness() };
}

export async function recordResendQuotaSnapshot(input: unknown) {
  const snapshot = resendQuotaSnapshotSchema.parse(input);
  if (isDemoMode()) return false;
  return withAuditTransaction(
    {
      reason: "Validated Resend provider quota headers captured",
      reasonCode: "EMAIL_PROVIDER_QUOTA_CAPTURED",
      systemIdentity: "EMAIL_PROVIDER_QUOTA",
    },
    async (client) => {
      const result = await client.query<{ changed: boolean }>(RESEND_QUOTA_WRITE_SQL, [
        snapshot.plan,
        snapshot.monthlyUsed,
        snapshot.monthlyLimit,
        snapshot.dailyUsed,
        snapshot.dailyLimit,
        snapshot.source,
        snapshot.responseStatusClass,
        snapshot.capturedAt,
      ]);
      return result.rows[0]?.changed === true;
    },
  );
}

export async function recordResendQuotaSnapshotSafely(input: unknown) {
  try {
    return await recordResendQuotaSnapshot(input);
  } catch {
    console.error(JSON.stringify({ event: "resend_quota_snapshot_persistence_error" }));
    return false;
  }
}

export async function executeEmailOperationsCommand(
  actor: SessionUser,
  command: EmailOperationsCommand,
) {
  requireManage(actor);
  if (!UUID_PATTERN.test(command.commandId)
    || command.reason.trim().length < 10
    || command.reason.trim().length > 1_000
    || /[\u0000-\u001f\u007f]/.test(command.reason)
    || (command.deliveryId && !UUID_PATTERN.test(command.deliveryId))) {
    throw new Error("email_operation_invalid");
  }
  if (command.details?.providerName !== undefined
    && command.details.providerName !== "resend") {
    throw new Error("email_operation_invalid");
  }
  if (isDemoMode()) {
    return command.action === "REVEAL"
      ? {
          changed: false,
          action: command.action,
          recipient: "approved.operator.fixture@axora.invalid",
          maskedRecipient: "ap***@axora.invalid",
        }
      : { changed: true, action: command.action };
  }
  return withAuditTransaction(
    {
      actor,
      reason: command.reason,
      commandId: command.commandId,
      reasonCode: `EMAIL_${command.action}`,
    },
    async (client) => {
      const query = await client.query<{ result: Record<string, unknown> }>(
        COMMAND_SQL,
        [
          command.commandId,
          command.action,
          command.deliveryKind ?? null,
          command.deliveryId ?? null,
          command.providerAgent ?? null,
          command.reason.trim(),
          JSON.stringify(command.details ?? {}),
        ],
      );
      if (!query.rows[0]?.result) throw new Error("email_operation_unavailable");
      return query.rows[0].result;
    },
  );
}

export async function recordEmailWebhookProcessingFailure(
  providerName: "resend",
  errorCode: "invalid_payload" | "processing_failed",
) {
  if (isDemoMode()) return;
  await withAuditTransaction(
    {
      reason: "Validated Resend webhook processing failed",
      systemIdentity: "EMAIL_PROVIDER_WEBHOOK",
      reasonCode: "EMAIL_WEBHOOK_FAILURE",
      outcome: "FAILURE",
    },
    async (client) => {
      await client.query(WEBHOOK_FAILURE_SQL, [providerName, errorCode]);
    },
  );
}

export const emailOperationsInternals = {
  requireView,
  requireManage,
  sql: {
    workspace: WORKSPACE_SQL,
    command: COMMAND_SQL,
    webhookFailure: WEBHOOK_FAILURE_SQL,
    resendQuotaRead: RESEND_QUOTA_READ_SQL,
    resendQuotaWrite: RESEND_QUOTA_WRITE_SQL,
  },
};
