import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser, SessionUser } from "./auth";
import { getDemoStore } from "./demo-data";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { appendWorkflowEvent, notifyWorkflowUsers } from "./workflow-repository";
import type { WorkflowNotificationMessage } from "./workflow-notification-i18n";

export const COMPANY_LIFECYCLE_STATUSES = [
  "NEW_LEAD",
  "UNDER_REVIEW",
  "ASSIGNED",
  "CONTACTED",
  "INFORMATION_PENDING",
  "ONBOARDING",
  "PORTAL_DRAFT",
  "COMPANY_REVIEW",
  "COMPANY_ADMINISTRATOR_INVITED",
  "COMPANY_ADMINISTRATOR_ACTIVATED",
  "ACTIVE",
  "DUPLICATE",
  "REJECTED",
  "INACTIVE",
  "SUSPENDED",
  "ARCHIVED",
] as const;

export type CompanyLifecycleStatus = typeof COMPANY_LIFECYCLE_STATUSES[number];

export const COMPANY_LIFECYCLE_ACTIONS = [
  "START_REVIEW",
  "ASSIGN",
  "REASSIGN",
  "ADD_BACKUP",
  "REPLACE_BACKUP",
  "MARK_CONTACTED",
  "REQUEST_INFORMATION",
  "START_ONBOARDING",
  "CREATE_PORTAL_DRAFT",
  "SUBMIT_COMPANY_REVIEW",
  "INVITE_ADMINISTRATOR",
  "SYNC_ADMINISTRATOR",
  "ACTIVATE",
  "SUSPEND",
  "MARK_INACTIVE",
  "ARCHIVE",
  "MARK_DUPLICATE",
  "REJECT",
  "CLEAR_DUPLICATE",
  "PUBLISH",
  "UNPUBLISH",
] as const;

export type CompanyLifecycleAction = typeof COMPANY_LIFECYCLE_ACTIONS[number];
export type CompanyAssignmentType = "PRIMARY" | "BACKUP";

const uuid = z.string().uuid();
const optionalDate = z.coerce.date().nullable();

const managerSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(300),
  email: z.string().trim().min(3).max(320),
}).strict();

const assignedManagerSchema = managerSchema.extend({
  assignedAt: optionalDate.optional(),
  coverageStartsAt: optionalDate.optional(),
  coverageEndsAt: optionalDate.optional(),
}).strict();

const onboardingItemSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
  label: z.string().trim().min(2).max(200),
  required: z.boolean(),
  status: z.enum(["PENDING", "PASSED", "FAILED", "WAIVED"]),
  blockingReason: z.string().max(1000).nullable(),
  completedAt: optionalDate,
}).strict();

const lifecycleHistorySchema = z.object({
  version: z.coerce.number().int().positive(),
  fromStatus: z.enum(COMPANY_LIFECYCLE_STATUSES).nullable(),
  toStatus: z.enum(COMPANY_LIFECYCLE_STATUSES),
  reason: z.string().max(1000).nullable(),
  changedAt: z.coerce.date(),
  changedByName: z.string().max(300).nullable(),
}).strict();

const duplicateCandidateSchema = z.object({
  id: uuid,
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(300),
  matchedFields: z.array(z.enum([
    "registrationNumber",
    "legalName",
    "displayName",
    "emailDomain",
    "contactEmail",
    "phone",
  ])).min(1),
  reviewStatus: z.enum(["PENDING", "CLEARED", "CONFIRMED"]),
}).strict();

export const companyLifecycleRecordSchema = z.object({
  id: uuid,
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(300),
  legalName: z.string().trim().min(2).max(300),
  registrationNumber: z.string().max(160),
  industry: z.string().max(300),
  companyInformation: z.string().max(5000).nullable(),
  websiteUrl: z.string().max(2048).nullable(),
  mainContactName: z.string().max(300),
  mainContactEmail: z.string().max(320),
  mainContactPhone: z.string().max(120),
  billingContactName: z.string().max(300),
  billingContactEmail: z.string().max(320),
  billingContactPhone: z.string().max(120),
  billingAddress: z.string().max(5000),
  paymentTerms: z.string().max(300),
  billingCycle: z.string().max(300),
  notes: z.string().max(5000).nullable(),
  status: z.enum(COMPANY_LIFECYCLE_STATUSES),
  version: z.coerce.number().int().positive(),
  active: z.boolean(),
  portalAccessEnabled: z.boolean(),
  isPubliclyListed: z.boolean(),
  duplicateReviewStatus: z.enum([
    "CLEAR",
    "POSSIBLE_DUPLICATE",
    "CLEARED",
    "CONFIRMED",
  ]),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  activatedAt: optionalDate,
  suspendedAt: optionalDate,
  suspensionReason: z.string().max(1000).nullable(),
  isAssignedToActor: z.boolean(),
  primaryManager: assignedManagerSchema.nullable(),
  backupManager: assignedManagerSchema.nullable(),
  onboarding: z.object({
    required: z.coerce.number().int().nonnegative(),
    passed: z.coerce.number().int().nonnegative(),
    items: z.array(onboardingItemSchema),
  }).strict(),
  duplicateCandidates: z.array(duplicateCandidateSchema),
  history: z.array(lifecycleHistorySchema),
  activationBlockedReasons: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/)),
  availableActions: z.array(z.enum(COMPANY_LIFECYCLE_ACTIONS)),
}).strict();

const workspaceSchema = z.object({
  capturedAt: z.coerce.date(),
  canCreate: z.boolean(),
  canViewAll: z.boolean(),
  managers: z.array(managerSchema),
  companies: z.array(companyLifecycleRecordSchema),
}).strict();

const mutationSchema = z.object({
  company: companyLifecycleRecordSchema.nullable(),
  companyId: uuid,
  companyName: z.string().trim().min(1).max(300),
  companyVersion: z.coerce.number().int().positive(),
  eventKey: z.string().regex(/^[a-z][a-z0-9_.-]{1,119}$/),
  notificationRecipientIds: z.array(uuid),
  blockedReasons: z.array(z.string()).optional(),
}).strict();

interface SnapshotRow extends QueryResultRow {
  snapshot: unknown;
}

export type CompanyLifecycleRecord = z.infer<typeof companyLifecycleRecordSchema>;
export type CompanyLifecycleWorkspace = z.infer<typeof workspaceSchema>;
export type CompanyLifecycleMutation = z.infer<typeof mutationSchema>;
export type CompanyLifecycleManager = z.infer<typeof managerSchema>;

export interface NewCompanyLeadInput {
  name: string;
  legalName: string;
  registrationNumber: string;
  industry: string;
  companyInformation?: string;
  websiteUrl?: string;
  mainContactName: string;
  mainContactEmail: string;
  mainContactPhone: string;
  billingContactName: string;
  billingContactEmail: string;
  billingContactPhone: string;
  billingAddress: string;
  paymentTerms: string;
  billingCycle: string;
  notes?: string;
}

export class CompanyLifecycleUnavailableError extends Error {
  constructor() {
    super("The requested company lifecycle operation is unavailable.");
    this.name = "CompanyLifecycleUnavailableError";
  }
}

function requiredAssignment(actor: SessionUser) {
  const parsed = uuid.safeParse(actor.roleAssignmentId);
  if (!parsed.success) throw new CompanyLifecycleUnavailableError();
  return parsed.data;
}

function parseMutation(raw: unknown) {
  const parsed = mutationSchema.safeParse(raw);
  if (!parsed.success) throw new CompanyLifecycleUnavailableError();
  return parsed.data;
}

function demoWorkspace(actor: AuthenticatedSessionUser): CompanyLifecycleWorkspace {
  const capturedAt = new Date();
  const companies = getDemoStore().companies
    .filter((company) => actor.isOwner || company.id === actor.companyId)
    .map((company): CompanyLifecycleRecord => ({
      id: company.id,
      code: company.code,
      name: company.name,
      legalName: company.name,
      registrationNumber: "DEMO",
      industry: company.industry,
      companyInformation: company.companyInformation ?? null,
      websiteUrl: company.websiteUrl ?? null,
      mainContactName: company.mainContactName,
      mainContactEmail: company.mainContactEmail,
      mainContactPhone: company.mainContactPhone,
      billingContactName: company.billingContactName,
      billingContactEmail: company.billingContactEmail,
      billingContactPhone: company.billingContactPhone,
      billingAddress: company.billingAddress,
      paymentTerms: String(company.paymentTerms),
      billingCycle: company.billingCycle,
      notes: company.notes ?? null,
      status: company.status === "Active" ? "ACTIVE" : "INACTIVE",
      version: 1,
      active: company.status === "Active",
      portalAccessEnabled: company.status === "Active",
      isPubliclyListed: false,
      duplicateReviewStatus: "CLEAR",
      createdAt: capturedAt,
      updatedAt: capturedAt,
      activatedAt: company.status === "Active" ? capturedAt : null,
      suspendedAt: null,
      suspensionReason: null,
      isAssignedToActor: false,
      primaryManager: null,
      backupManager: null,
      onboarding: { required: 8, passed: company.status === "Active" ? 8 : 3, items: [] },
      duplicateCandidates: [],
      history: [],
      activationBlockedReasons: company.status === "Active" ? [] : ["PRIMARY_MANAGER"],
      availableActions: [],
    }));
  return { capturedAt, canCreate: actor.isOwner, canViewAll: actor.isOwner, managers: [], companies };
}

export async function loadCompanyLifecycleWorkspace(
  actor: AuthenticatedSessionUser,
  capturedAt = new Date(),
): Promise<CompanyLifecycleWorkspace> {
  if (!Number.isFinite(capturedAt.getTime())) {
    throw new CompanyLifecycleUnavailableError();
  }
  if (isDemoMode()) return demoWorkspace(actor);
  try {
    const result = await query<SnapshotRow>(
      `SELECT public.axora_company_lifecycle_workspace($1,$2,$3) AS snapshot`,
      [actor.id, requiredAssignment(actor), capturedAt],
    );
    const parsed = workspaceSchema.safeParse(result.rows[0]?.snapshot);
    if (!parsed.success
      || parsed.data.capturedAt.getTime() !== capturedAt.getTime()) {
      throw new CompanyLifecycleUnavailableError();
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof CompanyLifecycleUnavailableError) throw error;
    throw new CompanyLifecycleUnavailableError();
  }
}

export async function createCompanyLeadInTransaction(
  client: PoolClient,
  input: NewCompanyLeadInput,
  actor: SessionUser,
  capturedAt = new Date(),
) {
  const result = await client.query<SnapshotRow>(`
    SELECT public.axora_create_company_lead(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19
    ) AS snapshot
  `, [
    actor.id,
    requiredAssignment(actor),
    input.name,
    input.legalName,
    input.registrationNumber,
    input.industry,
    input.companyInformation ?? "",
    input.websiteUrl ?? null,
    input.mainContactName,
    input.mainContactEmail,
    input.mainContactPhone,
    input.billingContactName,
    input.billingContactEmail,
    input.billingContactPhone,
    input.billingAddress,
    input.paymentTerms,
    input.billingCycle,
    input.notes ?? null,
    capturedAt,
  ]);
  return parseMutation(result.rows[0]?.snapshot);
}

export async function markCompanyBrandReadyInTransaction(
  client: PoolClient,
  companyId: string,
  actor: SessionUser,
  capturedAt = new Date(),
) {
  const result = await client.query<{ updated: boolean }>(`
    SELECT public.axora_mark_company_brand_ready($1,$2,$3,$4) AS updated
  `, [actor.id, requiredAssignment(actor), uuid.parse(companyId), capturedAt]);
  if (result.rows[0]?.updated !== true) throw new CompanyLifecycleUnavailableError();
}

const notificationMessages: Partial<Record<string, (name: string) => WorkflowNotificationMessage>> = {
  "company.lead.created": (companyName) => ({ key: "company_lead_created", companyName }),
  "company.assigned": (companyName) => ({ key: "company_assigned", companyName }),
  "company.reassigned": (companyName) => ({ key: "company_reassigned", companyName }),
  "company.information_requested": (companyName) => ({ key: "company_information_requested", companyName }),
  "company.administrator_activated": (companyName) => ({ key: "company_administrator_activated", companyName }),
  "company.activated": (companyName) => ({ key: "company_activated", companyName }),
  "company.suspended": (companyName) => ({ key: "company_suspended", companyName }),
};

export async function notifyCompanyLifecycleMutation(
  client: PoolClient,
  mutation: CompanyLifecycleMutation,
  actor: SessionUser,
) {
  const message = notificationMessages[mutation.eventKey]?.(mutation.companyName);
  if (!message || mutation.notificationRecipientIds.length === 0) return;
  const event = await appendWorkflowEvent(client, {
    companyId: mutation.companyId,
    aggregateType: "company",
    aggregateId: mutation.companyId,
    eventKey: mutation.eventKey,
    stableKey: `${mutation.eventKey}:${mutation.companyVersion}`,
    actor,
    newState: mutation.company?.status,
    source: "WEB",
    metadata: { companyName: mutation.companyName },
  });
  await notifyWorkflowUsers(client, event, {
    recipientUserIds: mutation.notificationRecipientIds,
    message,
    routePath: `/companies?created=${encodeURIComponent(mutation.companyId)}`,
    priority: mutation.eventKey === "company.suspended" ? "HIGH" : "NORMAL",
  });
}

async function mutate(
  actor: AuthenticatedSessionUser,
  reason: string,
  sql: string,
  values: unknown[],
) {
  if (isDemoMode()) throw new CompanyLifecycleUnavailableError();
  return withAuditTransaction({ actor, reason }, async (client) => {
    const result = await client.query<SnapshotRow>(sql, values);
    const mutation = parseMutation(result.rows[0]?.snapshot);
    await notifyCompanyLifecycleMutation(client, mutation, actor);
    return mutation;
  });
}

export function assignCompanyManager(
  actor: AuthenticatedSessionUser,
  input: {
    companyId: string;
    managerUserId: string;
    assignmentType: CompanyAssignmentType;
    coverageStartsAt?: Date;
    coverageEndsAt?: Date;
    reason: string;
  },
) {
  return mutate(
    actor,
    input.assignmentType === "PRIMARY" ? "Company primary manager assigned" : "Company backup manager assigned",
    `SELECT public.axora_assign_company_manager(
       $1,$2,$3,$4,$5,$6,$7,$8,$9
     ) AS snapshot`,
    [
      actor.id,
      requiredAssignment(actor),
      uuid.parse(input.companyId),
      uuid.parse(input.managerUserId),
      input.assignmentType,
      input.coverageStartsAt ?? null,
      input.coverageEndsAt ?? null,
      input.reason,
      new Date(),
    ],
  );
}

export function transitionCompanyLifecycle(
  actor: AuthenticatedSessionUser,
  companyId: string,
  toStatus: CompanyLifecycleStatus,
  reason: string,
) {
  return mutate(
    actor,
    `Company lifecycle changed to ${toStatus}`,
    `SELECT public.axora_transition_company_lifecycle(
       $1,$2,$3,$4,$5,$6
     ) AS snapshot`,
    [actor.id, requiredAssignment(actor), uuid.parse(companyId), toStatus, reason, new Date()],
  );
}

export function resolveCompanyDuplicate(
  actor: AuthenticatedSessionUser,
  companyId: string,
  decision: "CLEAR" | "CONFIRM",
  reason: string,
) {
  return mutate(
    actor,
    `Company duplicate review ${decision.toLowerCase()}`,
    `SELECT public.axora_resolve_company_duplicate(
       $1,$2,$3,$4,$5,$6
     ) AS snapshot`,
    [actor.id, requiredAssignment(actor), uuid.parse(companyId), decision, reason, new Date()],
  );
}

export function syncCompanyAdministrator(
  actor: AuthenticatedSessionUser,
  companyId: string,
  reason: string,
) {
  return mutate(
    actor,
    "Company Administrator lifecycle synchronized",
    `SELECT public.axora_sync_company_administrator(
       $1,$2,$3,$4,$5
     ) AS snapshot`,
    [actor.id, requiredAssignment(actor), uuid.parse(companyId), reason, new Date()],
  );
}

export function activateCompany(
  actor: AuthenticatedSessionUser,
  companyId: string,
  reason: string,
) {
  return mutate(
    actor,
    "Company activated after onboarding checks",
    `SELECT public.axora_activate_company($1,$2,$3,$4,$5) AS snapshot`,
    [actor.id, requiredAssignment(actor), uuid.parse(companyId), reason, new Date()],
  );
}

export function suspendCompany(
  actor: AuthenticatedSessionUser,
  companyId: string,
  reason: string,
) {
  return mutate(
    actor,
    "Company suspended with historical work preserved",
    `SELECT public.axora_suspend_company($1,$2,$3,$4,$5) AS snapshot`,
    [actor.id, requiredAssignment(actor), uuid.parse(companyId), reason, new Date()],
  );
}

export function setCompanyPublication(
  actor: AuthenticatedSessionUser,
  companyId: string,
  isPubliclyListed: boolean,
  reason: string,
) {
  return mutate(
    actor,
    isPubliclyListed ? "Company public listing enabled" : "Company public listing disabled",
    `SELECT public.axora_set_company_publication(
       $1,$2,$3,$4,$5,$6
     ) AS snapshot`,
    [actor.id, requiredAssignment(actor), uuid.parse(companyId), isPubliclyListed, reason, new Date()],
  );
}
