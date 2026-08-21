import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser, SessionUser } from "./auth";
import { getDemoStore } from "./demo-data";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { STANDARD_BILLING_TERMS } from "./types";
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

export const COMPANY_MANAGER_ACCESS_MODES = [
  "NORMAL",
  "TEMPORARY",
  "READ_ONLY",
  "SPECIFIC_PERMISSIONS",
] as const;
export const COMPANY_MANAGER_DOCUMENT_VISIBILITIES = [
  "STANDARD",
  "COMPANY_SHARED_ONLY",
  "NONE",
] as const;
export const COMPANY_MANAGER_ASSIGNABLE_PERMISSIONS = [
  "company.view.assigned",
  "company.edit",
  "user.view",
  "organization.branch.view",
  "request.view",
  "document.view",
  "report.view",
] as const;

export type CompanyManagerAccessMode = typeof COMPANY_MANAGER_ACCESS_MODES[number];
export type CompanyManagerDocumentVisibility = typeof COMPANY_MANAGER_DOCUMENT_VISIBILITIES[number];

const uuid = z.string().uuid();
const optionalDate = z.coerce.date().nullable();

const managerIdentitySchema = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(300),
  email: z.string().trim().min(3).max(320),
}).strict();

const managerSchema = managerIdentitySchema.extend({
  serviceRegionCode: z.string().regex(/^[A-Z][A-Z0-9_-]{1,39}$/),
  availabilityStatus: z.enum(["AVAILABLE", "LIMITED", "UNAVAILABLE"]),
  activePrimaryAssignments: z.coerce.number().int().nonnegative(),
  maxPrimaryAssignments: z.coerce.number().int().positive(),
  availableForPrimary: z.boolean(),
  availableForBackup: z.boolean(),
}).strict();

const assignedManagerSchema = managerIdentitySchema.extend({
  assignmentId: uuid,
  assignedAt: optionalDate.optional(),
  coverageStartsAt: optionalDate.optional(),
  coverageEndsAt: optionalDate.optional(),
  accessMode: z.enum(COMPANY_MANAGER_ACCESS_MODES),
  specificPermissionCodes: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{1,119}$/)),
  documentVisibility: z.enum(COMPANY_MANAGER_DOCUMENT_VISIBILITIES),
  coverageReason: z.string().trim().min(3).max(1000),
  assignedByName: z.string().trim().min(1).max(300),
  handoverNotes: z.string().max(5000).nullable(),
  handoverChecklist: z.array(z.string().trim().min(2).max(240)).max(20),
}).strict();

const assignmentHistorySchema = z.object({
  assignmentId: uuid,
  managerId: uuid,
  managerName: z.string().trim().min(1).max(300),
  assignmentType: z.enum(["PRIMARY", "BACKUP"]),
  status: z.enum(["ACTIVE", "ENDED"]),
  accessMode: z.enum(COMPANY_MANAGER_ACCESS_MODES),
  specificPermissionCodes: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{1,119}$/)),
  documentVisibility: z.enum(COMPANY_MANAGER_DOCUMENT_VISIBILITIES),
  coverageStartsAt: z.coerce.date(),
  coverageEndsAt: optionalDate,
  coverageReason: z.string().trim().min(3).max(1000),
  assignedByName: z.string().trim().min(1).max(300),
  assignedAt: z.coerce.date(),
  endedByName: z.string().trim().min(1).max(300).nullable(),
  endedAt: optionalDate,
  endReason: z.string().max(1000).nullable(),
  handoverNotes: z.string().max(5000).nullable(),
  handoverChecklist: z.array(z.string().trim().min(2).max(240)).max(20),
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
  serviceRegionCode: z.string().regex(/^[A-Z][A-Z0-9_-]{1,39}$/),
  isAssignedToActor: z.boolean(),
  primaryManager: assignedManagerSchema.nullable(),
  backupManager: assignedManagerSchema.nullable(),
  assignmentHistory: z.array(assignmentHistorySchema),
  openManagerWork: z.object({
    onboardingItems: z.coerce.number().int().nonnegative(),
    reminders: z.coerce.number().int().nonnegative(),
    leadTasks: z.coerce.number().int().nonnegative(),
  }).strict(),
  managerCoverage: z.object({
    status: z.enum(["COVERED", "GAP"]),
    reason: z.string().max(1000).nullable(),
    lastChangedAt: optionalDate,
  }).strict(),
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
  eventSequence: uuid.optional(),
  notificationRecipientIds: z.array(uuid),
  blockedReasons: z.array(z.string()).optional(),
}).strict();

const directCompanyCreationSchema = mutationSchema.extend({
  created: z.boolean(),
  creationLogoId: uuid.nullable(),
  creationThemeId: uuid.nullable(),
});

const companyCreationCommandConflictSchema = z.object({
  status: z.literal("COMMAND_CONFLICT"),
}).strict();

interface SnapshotRow extends QueryResultRow {
  snapshot: unknown;
}

export type CompanyLifecycleRecord = z.infer<typeof companyLifecycleRecordSchema>;
export type CompanyLifecycleWorkspace = z.infer<typeof workspaceSchema>;
export type CompanyLifecycleMutation = z.infer<typeof mutationSchema>;
export type DirectCompanyCreationMutation = z.infer<typeof directCompanyCreationSchema>;
export type CompanyLifecycleManager = z.infer<typeof managerSchema>;

export interface NewCompanyDirectInput {
  name: string;
  legalName: string;
  industry: string;
  companyInformation?: string;
  websiteUrl?: string;
  mainContactName: string;
  billingCycle: string;
  notes?: string;
}

export class CompanyLifecycleUnavailableError extends Error {
  constructor() {
    super("The requested company lifecycle operation is unavailable.");
    this.name = "CompanyLifecycleUnavailableError";
  }
}

export class CompanyCreationCommandConflictError extends Error {
  constructor() {
    super("The company creation command was already used for different input.");
    this.name = "CompanyCreationCommandConflictError";
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

const DEMO_CLIENT_ACCOUNT_MANAGER = Object.freeze({
  id: "20222222-2222-4222-8222-222222222222",
  name: "Agent fixture",
  email: "agent.fixture@axora.invalid",
  serviceRegionCode: "GLOBAL",
  availabilityStatus: "AVAILABLE" as const,
  activePrimaryAssignments: 0,
  maxPrimaryAssignments: 25,
  availableForPrimary: true,
  availableForBackup: true,
});

type DemoCompanyManagerAssignment = {
  managerUserId: string;
  assignedByName: string;
  assignedAt: Date;
  reason: string;
};

declare global {
  var __axoraDemoCompanyManagerAssignments:
    Map<string, DemoCompanyManagerAssignment> | undefined;
}

function demoCompanyManagerAssignments() {
  if (!global.__axoraDemoCompanyManagerAssignments) {
    global.__axoraDemoCompanyManagerAssignments = new Map();
  }
  return global.__axoraDemoCompanyManagerAssignments;
}

export function demoCompanyVisibleToActor(
  actor: Pick<SessionUser, "id" | "role" | "accountKind" | "companyId" | "isOwner">,
  companyId: string,
) {
  if (actor.isOwner && actor.accountKind === "PLATFORM") return true;
  if (actor.accountKind === "COMPANY") return actor.companyId === companyId;
  return actor.accountKind === "PLATFORM"
    && actor.role === "CLIENT_ACCOUNT_MANAGER"
    && demoCompanyManagerAssignments().get(companyId)?.managerUserId === actor.id;
}

export function registerDemoCompanyDirect(
  companyId: string,
  input: NewCompanyDirectInput,
) {
  const store = getDemoStore();
  if (store.companies.some((company) => company.id === companyId)) return;
  store.companies.push({
    id: companyId,
    code: `C-${String(store.companies.length + 1).padStart(3, "0")}`,
    name: input.name,
    industry: input.industry,
    ...(input.companyInformation
      ? { companyInformation: input.companyInformation }
      : {}),
    ...(input.websiteUrl ? { websiteUrl: input.websiteUrl } : {}),
    mainContactName: input.mainContactName,
    mainContactEmail: "",
    mainContactPhone: "",
    billingContactName: "",
    billingContactEmail: "",
    billingContactPhone: "",
    billingAddress: "",
    paymentTerms: STANDARD_BILLING_TERMS,
    billingCycle: input.billingCycle,
    taxRate: 0,
    estimatedDeliveryFee: 0,
    ...(input.notes ? { notes: input.notes } : {}),
    status: "Inactive",
  });
}

export function registerDemoCompanyManagerCoverage(
  companyId: string,
  managerUserId: string,
  assignedByName: string,
  reason: string,
  assignedAt = new Date(),
) {
  if (managerUserId !== DEMO_CLIENT_ACCOUNT_MANAGER.id
    || !getDemoStore().companies.some((company) => company.id === companyId)
    || reason.trim().length < 3
    || !Number.isFinite(assignedAt.getTime())) {
    throw new CompanyLifecycleUnavailableError();
  }
  demoCompanyManagerAssignments().set(companyId, {
    managerUserId,
    assignedByName,
    assignedAt: new Date(assignedAt),
    reason: reason.trim(),
  });
}

function demoWorkspace(actor: AuthenticatedSessionUser): CompanyLifecycleWorkspace {
  const capturedAt = new Date();
  const companies = getDemoStore().companies
    .filter((company) => demoCompanyVisibleToActor(actor, company.id))
    .map((company): CompanyLifecycleRecord => {
      const assignment = demoCompanyManagerAssignments().get(company.id);
      const primaryManager = assignment ? {
        id: assignment.managerUserId,
        name: DEMO_CLIENT_ACCOUNT_MANAGER.name,
        email: DEMO_CLIENT_ACCOUNT_MANAGER.email,
        assignmentId: assignment.managerUserId,
        assignedAt: assignment.assignedAt,
        coverageStartsAt: assignment.assignedAt,
        coverageEndsAt: null,
        accessMode: "NORMAL" as const,
        specificPermissionCodes: [],
        documentVisibility: "STANDARD" as const,
        coverageReason: assignment.reason,
        assignedByName: assignment.assignedByName,
        handoverNotes: null,
        handoverChecklist: [],
      } : null;
      return ({
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
      serviceRegionCode: "GLOBAL",
      isAssignedToActor: assignment?.managerUserId === actor.id,
      primaryManager,
      backupManager: null,
      assignmentHistory: [],
      openManagerWork: { onboardingItems: 0, reminders: 0, leadTasks: 0 },
      managerCoverage: assignment
        ? { status: "COVERED", reason: assignment.reason, lastChangedAt: assignment.assignedAt }
        : { status: "GAP", reason: null, lastChangedAt: null },
      onboarding: { required: 8, passed: company.status === "Active" ? 8 : 3, items: [] },
      duplicateCandidates: [],
      history: [],
      activationBlockedReasons: company.status === "Active" ? [] : ["PRIMARY_MANAGER"],
      availableActions: actor.isOwner
        ? assignment ? ["REASSIGN", "ADD_BACKUP"] : ["ASSIGN"]
        : [],
    });
    });
  return {
    capturedAt,
    canCreate: actor.isOwner,
    canViewAll: actor.isOwner,
    managers: actor.isOwner ? [{
      ...DEMO_CLIENT_ACCOUNT_MANAGER,
      activePrimaryAssignments: [...demoCompanyManagerAssignments().values()]
        .filter((assignment) => assignment.managerUserId === DEMO_CLIENT_ACCOUNT_MANAGER.id)
        .length,
    }] : [],
    companies,
  };
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

export function findAuthorizedCompanyLifecycleRecord(
  workspace: CompanyLifecycleWorkspace,
  companyId: string,
) {
  return workspace.companies.find((company) => company.id === companyId);
}

export async function createCompanyDirectInTransaction(
  client: PoolClient,
  input: NewCompanyDirectInput,
  actor: SessionUser,
  commandId: string,
  logoSha256: string,
  capturedAt = new Date(),
) {
  if (!actor.isOwner || actor.accountKind !== "PLATFORM") {
    throw new CompanyLifecycleUnavailableError();
  }
  const result = await client.query<SnapshotRow>(`
    SELECT public.axora_create_company_direct(
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
    ) AS snapshot
  `, [
    actor.id,
    requiredAssignment(actor),
    uuid.parse(commandId),
    z.string().regex(/^[0-9a-f]{64}$/).parse(logoSha256),
    input.name,
    input.legalName,
    input.industry,
    input.companyInformation ?? "",
    input.websiteUrl ?? null,
    input.mainContactName,
    input.billingCycle,
    input.notes ?? null,
    capturedAt,
  ]);
  if (companyCreationCommandConflictSchema.safeParse(result.rows[0]?.snapshot).success) {
    throw new CompanyCreationCommandConflictError();
  }
  const parsed = directCompanyCreationSchema.safeParse(result.rows[0]?.snapshot);
  if (!parsed.success) throw new CompanyLifecycleUnavailableError();
  return parsed.data;
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
    stableKey: `${mutation.eventKey}:${mutation.eventSequence ?? mutation.companyVersion}`,
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
    accessMode: CompanyManagerAccessMode;
    specificPermissionCodes: Array<typeof COMPANY_MANAGER_ASSIGNABLE_PERMISSIONS[number]>;
    documentVisibility: CompanyManagerDocumentVisibility;
    handoverNotes?: string;
    handoverChecklist: string[];
    reason: string;
  },
) {
  if (!actor.isOwner || actor.accountKind !== "PLATFORM") {
    throw new CompanyLifecycleUnavailableError();
  }
  if (isDemoMode()) {
    if (input.managerUserId !== DEMO_CLIENT_ACCOUNT_MANAGER.id
      || !getDemoStore().companies.some((company) => company.id === input.companyId)) {
      throw new CompanyLifecycleUnavailableError();
    }
    demoCompanyManagerAssignments().set(input.companyId, {
      managerUserId: input.managerUserId,
      assignedByName: actor.name,
      assignedAt: new Date(),
      reason: input.reason,
    });
    const company = demoWorkspace(actor).companies.find(
      (candidate) => candidate.id === input.companyId,
    );
    if (!company) throw new CompanyLifecycleUnavailableError();
    return Promise.resolve({
      company,
      companyId: company.id,
      companyName: company.name,
      companyVersion: company.version,
      eventKey: "company.assigned",
      notificationRecipientIds: [input.managerUserId],
    } satisfies CompanyLifecycleMutation);
  }
  return mutate(
    actor,
    input.assignmentType === "PRIMARY" ? "Company primary manager assigned" : "Company backup manager assigned",
    `SELECT public.axora_manage_company_assignment(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15
     ) AS snapshot`,
    [
      actor.id,
      requiredAssignment(actor),
      uuid.parse(input.companyId),
      uuid.parse(input.managerUserId),
      input.assignmentType,
      input.coverageStartsAt ?? null,
      input.coverageEndsAt ?? null,
      input.accessMode,
      input.specificPermissionCodes,
      input.documentVisibility,
      input.handoverNotes ?? null,
      input.handoverChecklist,
      input.reason,
      false,
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
