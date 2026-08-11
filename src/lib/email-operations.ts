import type { SessionUser } from "./auth";
import { isDemoMode, withAuditTransaction } from "./db";
import { canAccess } from "./permissions";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^20\d{2}-\d{2}-\d{2}$/;
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_.-]{1,119}$/;
const ERROR_PATTERN = /^[a-z0-9_]{1,64}$/;
const DOMAIN_PATTERN = /^[a-z0-9.-]{3,253}$/;

export const EMAIL_PROVIDER_AGENTS = [
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

export type EmailProviderAgent = (typeof EMAIL_PROVIDER_AGENTS)[number];
export type EmailDeliveryStatus = (typeof EMAIL_DELIVERY_STATUSES)[number];
export type EmailDeliveryKind = "ACCOUNT_SETUP" | "TRANSACTIONAL" | "WORKFLOW";

export interface EmailOperationsFilters {
  from?: string;
  to?: string;
  agent?: EmailProviderAgent;
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
  providerAgent: EmailProviderAgent;
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

export interface EmailAgentSummary {
  providerAgent: EmailProviderAgent;
  paused: boolean;
  changedAt: string;
  revision: number;
  queueDepth: number;
  retrying: number;
  failures: number;
  oldestQueuedAt?: string;
}

export interface EmailProviderHealth {
  providerName?: string;
  source: "SUPPORTED_API" | "MANUAL" | "MISSING";
  remainingRecipientUnits?: number;
  allowanceRenewsAt?: string;
  creditExpiresAt?: string;
  accountState: string;
  domainName?: string;
  domainState: string;
  configurationState: string;
  lastProviderSubmissionAt?: string;
  lastProviderWebhookAt?: string;
  capturedAt?: string;
  forecastDays?: number;
  threshold: string;
}

export type EmailProviderRuntimeState =
  | "DELIVERY_DISABLED"
  | "WEBHOOK_BOOTSTRAP"
  | "SIGNED_WEBHOOK_CONFIGURED"
  | "ACCOUNT_REVIEW_PENDING"
  | "READY_FOR_CONTROLLED_SEND"
  | "FULLY_ENABLED"
  | "MISCONFIGURED";

export interface EmailProviderRuntimeReadiness {
  providerName: string;
  state: EmailProviderRuntimeState;
  deliveryEnabled: boolean;
  eventsEnabled: boolean;
  bootstrapEnabled: boolean;
  accountReviewed: boolean;
  domainVerified: boolean;
  creditsReady: boolean;
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
  agents: EmailAgentSummary[];
  dailyUsage: Array<{ day: string; recipientUnits: number; attempts: number }>;
  providerRuntime: EmailProviderRuntimeReadiness;
  providerHealth?: EmailProviderHealth;
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
  providerAgent?: EmailProviderAgent;
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
  const agentValue = first(input.agent);
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
    ...(EMAIL_PROVIDER_AGENTS.includes(agentValue as EmailProviderAgent)
      ? { agent: agentValue as EmailProviderAgent } : {}),
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
  const bootstrapEnabled = env.ZEPTOMAIL_WEBHOOK_BOOTSTRAP_ENABLED === "true";
  const accountReviewed = env.ZEPTOMAIL_ACCOUNT_REVIEWED === "true";
  const domainVerified = env.ZEPTOMAIL_DOMAIN_VERIFIED === "true";
  const creditsReady = env.ZEPTOMAIL_CREDITS_READY === "true";
  const webhookVerified = env.ZEPTOMAIL_WEBHOOK_VERIFIED === "true";
  const allZeptoGates = accountReviewed && domainVerified && creditsReady && webhookVerified;
  const invalid = bootstrapEnabled && (deliveryEnabled || eventsEnabled)
    || deliveryEnabled && (!eventsEnabled || !allZeptoGates)
    || webhookVerified && (bootstrapEnabled || !eventsEnabled);
  let state: EmailProviderRuntimeState = "DELIVERY_DISABLED";
  if (invalid) state = "MISCONFIGURED";
  else if (bootstrapEnabled) state = "WEBHOOK_BOOTSTRAP";
  else if (deliveryEnabled) state = "FULLY_ENABLED";
  else if (eventsEnabled && !webhookVerified) state = "SIGNED_WEBHOOK_CONFIGURED";
  else if (eventsEnabled && allZeptoGates) state = "READY_FOR_CONTROLLED_SEND";
  else if (providerName === "zeptomail" && !accountReviewed) state = "ACCOUNT_REVIEW_PENDING";
  return {
    providerName,
    state,
    deliveryEnabled,
    eventsEnabled,
    bootstrapEnabled,
    accountReviewed,
    domainVerified,
    creditsReady,
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
      providerName: "zeptomail",
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
      providerName: "zeptomail",
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
    agents: EMAIL_PROVIDER_AGENTS.map((providerAgent) => ({
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
    providerRuntime: emailProviderRuntimeReadiness(),
    providerHealth: canManage ? {
      providerName: "zeptomail",
      source: "MANUAL",
      remainingRecipientUnits: 8_420,
      accountState: "HEALTHY",
      domainName: "axora.management",
      domainState: "VERIFIED",
      configurationState: "HEALTHY",
      capturedAt: new Date(now.getTime() - 3_600_000).toISOString(),
      forecastDays: 27,
      threshold: "HEALTHY",
    } : undefined,
    webhooks: canManage ? [{
      providerName: "zeptomail",
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
      return query.rows[0].workspace;
    },
  );
  return { ...workspace, providerRuntime: emailProviderRuntimeReadiness() };
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
  providerName: "zeptomail" | "cloudflare-email-service",
  errorCode: "invalid_payload" | "processing_failed",
) {
  if (isDemoMode()) return;
  await withAuditTransaction(
    {
      reason: "Validated email provider webhook processing failed",
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
  },
};
