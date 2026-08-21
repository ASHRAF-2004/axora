import { createHash, randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser, SessionUser } from "./auth";
import {
  registerDemoCompanyDirect,
  registerDemoCompanyManagerCoverage,
} from "./company-lifecycle";
import { isDemoMode, query, withAuditTransaction } from "./db";
import {
  insertContactAcknowledgementEmailOutbox,
  insertContactEmailOutbox,
  type SupportedEmailLocale,
} from "./transactional-email";

export const COMPANY_LEAD_STATUSES = [
  "NEW",
  "ASSIGNED",
  "CONTACTED",
  "INFORMATION_PENDING",
  "QUALIFIED",
  "ONBOARDING",
  "ACTIVE",
  "CONVERTED",
  "DUPLICATE",
  "REJECTED",
  "ARCHIVED",
] as const;

export const COMPANY_LEAD_ACTIONS = [
  "ASSIGN",
  "REASSIGN",
  "MARK_CONTACTED",
  "REQUEST_INFORMATION",
  "QUALIFY",
  "REJECT",
  "CONVERT",
  "ACTIVATE",
  "REVIEW_DUPLICATE",
  "ADD_NOTE",
  "ADD_TASK",
  "ANONYMIZE",
] as const;

export type CompanyLeadStatus = typeof COMPANY_LEAD_STATUSES[number];
export type CompanyLeadAction = typeof COMPANY_LEAD_ACTIONS[number];

const uuid = z.string().uuid();
const nullableDate = z.coerce.date().nullable();
const managerSchema = z.object({
  id: uuid,
  name: z.string().trim().min(1).max(300),
  email: z.string().trim().min(3).max(320),
}).strict();
const eventSchema = z.object({
  id: uuid,
  leadId: uuid,
  eventKey: z.string().regex(/^[a-z][a-z0-9_.-]{1,119}$/),
  eventVersion: z.coerce.number().int().positive(),
  created: z.boolean(),
  occurredAt: z.coerce.date(),
}).strict();
const assignmentSchema = z.object({
  id: uuid,
  managerId: uuid,
  managerName: z.string().trim().min(1).max(300),
  assignedAt: z.coerce.date(),
  reason: z.string().trim().min(3).max(1000),
}).strict();
const assignmentHistorySchema = z.object({
  id: uuid,
  managerId: uuid,
  managerName: z.string().trim().min(1).max(300),
  status: z.enum(["ACTIVE", "ENDED"]),
  assignedAt: z.coerce.date(),
  endedAt: nullableDate,
  reason: z.string().trim().min(3).max(1000),
  endReason: z.string().max(1100).nullable(),
}).strict();
const duplicateCandidateSchema = z.object({
  id: uuid,
  kind: z.enum(["LEAD", "COMPANY"]),
  recordId: uuid,
  label: z.string().trim().min(1).max(300),
  matchedFields: z.array(z.string().trim().min(1).max(80)).min(1),
  reviewStatus: z.enum(["PENDING", "CLEARED", "CONFIRMED"]),
}).strict();
const noteSchema = z.object({
  id: uuid,
  type: z.enum(["INTERNAL", "CONTACT_ATTEMPT", "INFORMATION_RECEIVED"]),
  note: z.string().trim().min(2).max(5000),
  createdByName: z.string().trim().min(1).max(300),
  createdAt: z.coerce.date(),
}).strict();
const taskSchema = z.object({
  id: uuid,
  title: z.string().trim().min(2).max(240),
  dueAt: z.coerce.date(),
  status: z.enum(["OPEN", "COMPLETED"]),
  assignedUserId: uuid,
  assignedUserName: z.string().trim().min(1).max(300),
  completionNote: z.string().max(1000).nullable(),
}).strict();
const statusHistorySchema = z.object({
  fromStatus: z.enum(COMPANY_LEAD_STATUSES).nullable(),
  toStatus: z.enum(COMPANY_LEAD_STATUSES),
  reason: z.string().trim().min(1).max(1000),
  changedAt: z.coerce.date(),
  changedByName: z.string().max(300).nullable(),
}).strict();

export const companyLeadRecordSchema = z.object({
  id: uuid,
  code: z.string().regex(/^LEAD-[0-9]{8,}$/),
  status: z.enum(COMPANY_LEAD_STATUSES),
  statusVersion: z.coerce.number().int().positive(),
  source: z.string().trim().min(2).max(80),
  duplicateRisk: z.enum(["CLEAR", "POSSIBLE_DUPLICATE", "CLEARED", "CONFIRMED"]),
  usesPersonalEmail: z.boolean(),
  slaDueAt: z.coerce.date(),
  overdue: z.boolean(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
  retentionUntil: z.coerce.date(),
  anonymizedAt: nullableDate,
  convertedCompanyId: uuid.nullable(),
  companyName: z.string().trim().min(2).max(200),
  legalName: z.string().trim().min(2).max(300),
  registrationNumber: z.string().max(160),
  contactName: z.string().trim().min(2).max(200),
  contactEmail: z.string().trim().max(254),
  phoneCountryCode: z.string().max(12),
  phone: z.string().trim().max(40).nullable(),
  country: z.string().trim().max(120),
  region: z.string().trim().max(160),
  city: z.string().trim().min(2).max(160),
  industry: z.string().trim().min(2).max(200),
  employeeRange: z.string().trim().min(1).max(40),
  branchRange: z.string().trim().min(1).max(40),
  spendRange: z.string().trim().min(1).max(40),
  preferredContactMethod: z.enum(["EMAIL", "PHONE", "WHATSAPP", "VIDEO_CALL"]),
  preferredContactTime: z.string().max(160),
  contactTimezone: z.string().trim().min(1).max(80),
  locale: z.enum(["en", "ar", "ms"]),
  subject: z.string().trim().min(3).max(200),
  message: z.string().trim().min(10).max(5000),
  consentAt: nullableDate,
  privacyPolicyVersion: z.string().trim().min(1).max(80),
  sourcePage: z.string().trim().min(1).max(500),
  sourceMetadata: z.record(z.string(), z.unknown()),
  assignment: assignmentSchema.nullable(),
  assignmentHistory: z.array(assignmentHistorySchema),
  duplicateCandidates: z.array(duplicateCandidateSchema),
  notes: z.array(noteSchema),
  tasks: z.array(taskSchema),
  statusHistory: z.array(statusHistorySchema),
  availableActions: z.array(z.enum(COMPANY_LEAD_ACTIONS)),
}).strict();

const workspaceSchema = z.object({
  capturedAt: z.coerce.date(),
  canViewAll: z.boolean(),
  managers: z.array(managerSchema),
  leads: z.array(companyLeadRecordSchema),
}).strict();
const mutationSchema = z.object({
  leadId: uuid,
  leadCode: z.string().regex(/^LEAD-[0-9]{8,}$/),
  status: z.enum(COMPANY_LEAD_STATUSES),
  statusVersion: z.coerce.number().int().positive(),
  event: eventSchema,
  notificationRecipientIds: z.array(uuid),
  companyId: uuid.optional(),
}).passthrough();
const publicMutationSchema = z.object({
  created: z.boolean(),
  leadId: uuid,
  leadCode: z.string().regex(/^LEAD-[0-9]{8,}$/),
  submissionId: uuid,
  event: eventSchema,
  notificationRecipientIds: z.array(uuid),
}).strict();
const publicContactMutationSchema = z.object({
  created: z.boolean(),
  submissionId: uuid,
}).strict();
const overdueMutationSchema = z.object({
  leadId: uuid,
  leadCode: z.string().regex(/^LEAD-[0-9]{8,}$/),
  event: eventSchema,
  notificationRecipientIds: z.array(uuid),
}).strict();

interface SnapshotRow extends QueryResultRow { snapshot: unknown }
export type CompanyLeadRecord = z.infer<typeof companyLeadRecordSchema>;
export type CompanyLeadWorkspace = z.infer<typeof workspaceSchema>;
export type CompanyLeadMutation = z.infer<typeof mutationSchema>;
export type CompanyLeadManager = z.infer<typeof managerSchema>;

export interface AcquisitionLeadInput {
  companyName: string;
  legalName: string;
  contactName: string;
  city: string;
  industry: string;
  employeeRange: "1_10" | "11_50" | "51_200" | "201_500" | "501_1000" | "1001_PLUS";
  branchRange: "1" | "2_5" | "6_20" | "21_50" | "51_PLUS";
  spendRange: "UNDER_10K" | "10K_50K" | "50K_250K" | "250K_1M" | "OVER_1M" | "UNDISCLOSED";
  locale: "en" | "ar" | "ms";
  timezone: string;
  subject: string;
  message: string;
}

const retiredCompanyLeadExportKeys = new Set<keyof CompanyLeadRecord>([
  "registrationNumber",
  "contactEmail",
  "phoneCountryCode",
  "phone",
  "country",
  "region",
  "preferredContactTime",
  "usesPersonalEmail",
]);
const retiredCompanyLeadMatchFields = new Set([
  "registrationNumber", "emailDomain", "contactEmail", "phone",
]);

export class CompanyLeadUnavailableError extends Error {
  constructor() {
    super("The requested company lead operation is unavailable.");
    this.name = "CompanyLeadUnavailableError";
  }
}

export class CompanyLeadCommandConflictError extends Error {
  constructor() {
    super("The company lead command was already used for different input.");
    this.name = "CompanyLeadCommandConflictError";
  }
}

type DemoAcquisitionLeadCommand = {
  actorUserId: string;
  payloadHash: string;
  leadId: string;
  eventId: string;
};

type DemoCompanyLeadState = {
  commands: Map<string, DemoAcquisitionLeadCommand>;
  leads: Map<string, CompanyLeadRecord>;
};

const DEMO_COMPANY_LEAD_MANAGER = Object.freeze({
  id: "20222222-2222-4222-8222-222222222222",
  name: "Agent fixture",
  email: "agent.fixture@axora.invalid",
});

declare global {
  var __axoraDemoCompanyLeadState: DemoCompanyLeadState | undefined;
}

function demoCompanyLeadState() {
  if (!global.__axoraDemoCompanyLeadState) {
    global.__axoraDemoCompanyLeadState = {
      commands: new Map(),
      leads: new Map(),
    };
  }
  return global.__axoraDemoCompanyLeadState;
}

function deterministicUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function deterministicLeadCode(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex").slice(0, 15);
  const numeric = (BigInt(`0x${hex}`) % 1_000_000_000_000n)
    .toString()
    .padStart(12, "0");
  return `LEAD-${numeric}`;
}

function normalizedAcquisitionLeadInput(input: AcquisitionLeadInput): AcquisitionLeadInput {
  return {
    companyName: input.companyName.trim(),
    legalName: input.legalName.trim(),
    contactName: input.contactName.trim(),
    city: input.city.trim(),
    industry: input.industry.trim(),
    employeeRange: input.employeeRange,
    branchRange: input.branchRange,
    spendRange: input.spendRange,
    locale: input.locale,
    timezone: input.timezone.trim(),
    subject: input.subject.trim(),
    message: input.message.trim(),
  };
}

function demoAcquisitionPayloadHash(
  actor: AuthenticatedSessionUser,
  input: AcquisitionLeadInput,
) {
  return createHash("sha256").update(JSON.stringify({
    actorUserId: actor.id,
    ...normalizedAcquisitionLeadInput(input),
  })).digest("hex");
}

function addUtcMonths(value: Date, months: number) {
  const next = new Date(value);
  next.setUTCMonth(next.getUTCMonth() + months);
  return next;
}

function demoLeadMutation(
  lead: CompanyLeadRecord,
  eventId: string,
  created: boolean,
): CompanyLeadMutation {
  return {
    leadId: lead.id,
    leadCode: lead.code,
    status: lead.status,
    statusVersion: lead.statusVersion,
    event: {
      id: eventId,
      leadId: lead.id,
      eventKey: "company.lead.created",
      eventVersion: 1,
      created,
      occurredAt: lead.createdAt,
    },
    notificationRecipientIds: [],
  };
}

function createDemoAcquisitionLead(
  actor: AuthenticatedSessionUser,
  input: AcquisitionLeadInput,
  commandId: string,
  capturedAt: Date,
) {
  if (!actor.isOwner || actor.accountKind !== "PLATFORM"
    || !Number.isFinite(capturedAt.getTime())) {
    throw new CompanyLeadUnavailableError();
  }
  const normalized = normalizedAcquisitionLeadInput(input);
  const payloadHash = demoAcquisitionPayloadHash(actor, normalized);
  const state = demoCompanyLeadState();
  const existing = state.commands.get(commandId);
  if (existing) {
    if (existing.actorUserId !== actor.id || existing.payloadHash !== payloadHash) {
      throw new CompanyLeadCommandConflictError();
    }
    const lead = state.leads.get(existing.leadId);
    if (!lead) throw new CompanyLeadUnavailableError();
    return demoLeadMutation(lead, existing.eventId, false);
  }
  const leadId = deterministicUuid(`company-lead:${actor.id}:${commandId}`);
  const eventId = deterministicUuid(`company-lead-event:${actor.id}:${commandId}`);
  const lead: CompanyLeadRecord = {
    id: leadId,
    code: deterministicLeadCode(`company-lead-code:${actor.id}:${commandId}`),
    status: "NEW",
    statusVersion: 1,
    source: "OWNER_CREATED",
    duplicateRisk: "CLEAR",
    usesPersonalEmail: false,
    slaDueAt: new Date(capturedAt.getTime() + 24 * 60 * 60 * 1000),
    overdue: false,
    createdAt: new Date(capturedAt),
    updatedAt: new Date(capturedAt),
    retentionUntil: addUtcMonths(capturedAt, 24),
    anonymizedAt: null,
    convertedCompanyId: null,
    companyName: normalized.companyName,
    legalName: normalized.legalName,
    registrationNumber: "",
    contactName: normalized.contactName,
    contactEmail: "",
    phoneCountryCode: "",
    phone: null,
    country: "",
    region: "",
    city: normalized.city,
    industry: normalized.industry,
    employeeRange: normalized.employeeRange,
    branchRange: normalized.branchRange,
    spendRange: normalized.spendRange,
    preferredContactMethod: "EMAIL",
    preferredContactTime: "",
    contactTimezone: normalized.timezone,
    locale: normalized.locale,
    subject: normalized.subject,
    message: normalized.message,
    consentAt: null,
    privacyPolicyVersion: "owner-created-lead",
    sourcePage: "/companies/leads/new",
    sourceMetadata: { source: "OWNER_CREATED" },
    assignment: null,
    assignmentHistory: [],
    duplicateCandidates: [],
    notes: [],
    tasks: [],
    statusHistory: [{
      fromStatus: null,
      toStatus: "NEW",
      reason: "Company Lead created by Platform Owner",
      changedAt: new Date(capturedAt),
      changedByName: actor.name,
    }],
    availableActions: [],
  };
  state.commands.set(commandId, {
    actorUserId: actor.id,
    payloadHash,
    leadId,
    eventId,
  });
  state.leads.set(leadId, lead);
  return demoLeadMutation(lead, eventId, true);
}

function demoAvailableLeadActions(
  lead: CompanyLeadRecord,
  actor: AuthenticatedSessionUser,
): CompanyLeadAction[] {
  const owner = actor.isOwner && actor.accountKind === "PLATFORM";
  const assignedCam = actor.accountKind === "PLATFORM"
    && actor.role === "CLIENT_ACCOUNT_MANAGER"
    && lead.assignment?.managerId === actor.id;
  if (!owner && !assignedCam) return [];
  const actions: CompanyLeadAction[] = [];
  const terminal = ["CONVERTED","DUPLICATE","REJECTED","ARCHIVED"]
    .includes(lead.status);
  if (owner && !terminal) actions.push(lead.assignment ? "REASSIGN" : "ASSIGN");
  if (["NEW","ASSIGNED","INFORMATION_PENDING"].includes(lead.status)) {
    actions.push("MARK_CONTACTED");
  }
  if (["NEW","ASSIGNED","CONTACTED","QUALIFIED"].includes(lead.status)) {
    actions.push("REQUEST_INFORMATION");
  }
  if (["NEW","ASSIGNED","CONTACTED","INFORMATION_PENDING"].includes(lead.status)) {
    actions.push("QUALIFY");
  }
  if (!terminal) actions.push("REJECT","ADD_NOTE","ADD_TASK");
  if (lead.status === "QUALIFIED" && lead.duplicateRisk !== "POSSIBLE_DUPLICATE") {
    actions.push("CONVERT");
  }
  return actions;
}

function demoLeadForActor(
  lead: CompanyLeadRecord,
  actor: AuthenticatedSessionUser,
): CompanyLeadRecord {
  return {
    ...lead,
    assignment: lead.assignment ? { ...lead.assignment } : null,
    assignmentHistory: lead.assignmentHistory.map((item) => ({ ...item })),
    notes: lead.notes.map((item) => ({ ...item })),
    tasks: lead.tasks.map((item) => ({ ...item })),
    statusHistory: lead.statusHistory.map((item) => ({ ...item })),
    availableActions: demoAvailableLeadActions(lead,actor),
  };
}

function demoActorCanFollowUpLead(
  actor: AuthenticatedSessionUser,
  lead: CompanyLeadRecord,
) {
  return (actor.isOwner && actor.accountKind === "PLATFORM")
    || (actor.accountKind === "PLATFORM"
      && actor.role === "CLIENT_ACCOUNT_MANAGER"
      && lead.assignment?.managerId === actor.id);
}

function demoStateMutation(
  lead: CompanyLeadRecord,
  eventKey: string,
  occurredAt = new Date(),
  companyId?: string,
  eventNonce = "",
): CompanyLeadMutation {
  return {
    leadId: lead.id,
    leadCode: lead.code,
    status: lead.status,
    statusVersion: lead.statusVersion,
    event: {
      id: deterministicUuid(
        `company-lead-event:${lead.id}:${eventKey}:${lead.statusVersion}:${eventNonce}`,
      ),
      leadId: lead.id,
      eventKey,
      eventVersion: lead.statusVersion,
      created: true,
      occurredAt,
    },
    notificationRecipientIds: lead.assignment
      ? [lead.assignment.managerId]
      : [],
    ...(companyId ? { companyId } : {}),
  };
}

function demoAssignCompanyLead(
  actor: AuthenticatedSessionUser,
  leadId: string,
  managerUserId: string,
  reason: string,
) {
  const lead = demoCompanyLeadState().leads.get(leadId);
  const occurredAt = new Date();
  if (!lead || !actor.isOwner || actor.accountKind !== "PLATFORM"
    || managerUserId !== DEMO_COMPANY_LEAD_MANAGER.id
    || reason.trim().length < 3 || reason.trim().length > 1000
    || ["ONBOARDING","ACTIVE","CONVERTED","DUPLICATE","REJECTED","ARCHIVED"]
      .includes(lead.status)
    || lead.assignment?.managerId === managerUserId) {
    throw new CompanyLeadUnavailableError();
  }
  if (lead.assignment) {
    const current = lead.assignment;
    const history = lead.assignmentHistory.find((item) => item.id === current.id);
    if (history) {
      history.status = "ENDED";
      history.endedAt = occurredAt;
      history.endReason = `Reassigned: ${reason.trim()}`;
    }
  }
  const assignment = {
    id: deterministicUuid(`company-lead-assignment:${lead.id}:${managerUserId}:${occurredAt.toISOString()}`),
    managerId: managerUserId,
    managerName: DEMO_COMPANY_LEAD_MANAGER.name,
    assignedAt: occurredAt,
    reason: reason.trim(),
  };
  lead.assignment = assignment;
  lead.assignmentHistory.unshift({
    ...assignment,
    status: "ACTIVE",
    endedAt: null,
    endReason: null,
  });
  if (lead.status === "NEW") {
    lead.status = "ASSIGNED";
    lead.statusVersion += 1;
    lead.statusHistory.unshift({
      fromStatus: "NEW",
      toStatus: "ASSIGNED",
      reason: "Lead assigned to Agent",
      changedAt: occurredAt,
      changedByName: actor.name,
    });
  }
  lead.updatedAt = occurredAt;
  return demoStateMutation(lead,"company.lead.assigned",occurredAt);
}

const DEMO_LEAD_TRANSITIONS: Readonly<Partial<Record<
  CompanyLeadStatus,
  readonly CompanyLeadStatus[]
>>> = {
  NEW: ["CONTACTED","INFORMATION_PENDING","QUALIFIED","REJECTED"],
  ASSIGNED: ["CONTACTED","INFORMATION_PENDING","QUALIFIED","REJECTED"],
  CONTACTED: ["INFORMATION_PENDING","QUALIFIED","REJECTED"],
  INFORMATION_PENDING: ["CONTACTED","QUALIFIED","REJECTED"],
  QUALIFIED: ["INFORMATION_PENDING","REJECTED"],
  ACTIVE: ["ARCHIVED"],
  CONVERTED: ["ARCHIVED"],
  DUPLICATE: ["ARCHIVED"],
  REJECTED: ["ARCHIVED"],
};

function demoTransitionCompanyLead(
  actor: AuthenticatedSessionUser,
  leadId: string,
  status: CompanyLeadStatus,
  reason: string,
) {
  const lead = demoCompanyLeadState().leads.get(leadId);
  if (!lead || !demoActorCanFollowUpLead(actor,lead)
    || reason.trim().length < 3 || reason.trim().length > 1000
    || !DEMO_LEAD_TRANSITIONS[lead.status]?.includes(status)) {
    throw new CompanyLeadUnavailableError();
  }
  const occurredAt = new Date();
  const fromStatus = lead.status;
  lead.status = status;
  lead.statusVersion += 1;
  lead.updatedAt = occurredAt;
  lead.statusHistory.unshift({
    fromStatus,
    toStatus: status,
    reason: reason.trim(),
    changedAt: occurredAt,
    changedByName: actor.name,
  });
  const eventKey = status === "CONTACTED"
    ? "company.lead.contacted"
    : status === "INFORMATION_PENDING"
      ? "company.lead.information_requested"
      : status === "QUALIFIED"
        ? "company.lead.qualified"
        : status === "REJECTED"
          ? "company.lead.rejected"
          : status === "ARCHIVED"
            ? "company.lead.archived"
            : "company.lead.status_changed";
  return demoStateMutation(lead,eventKey,occurredAt);
}

function demoConvertCompanyLead(
  actor: AuthenticatedSessionUser,
  leadId: string,
  reason: string,
) {
  const lead = demoCompanyLeadState().leads.get(leadId);
  if (!lead || !demoActorCanFollowUpLead(actor,lead) || lead.status !== "QUALIFIED"
    || lead.duplicateRisk === "POSSIBLE_DUPLICATE"
    || reason.trim().length < 3 || reason.trim().length > 1000) {
    throw new CompanyLeadUnavailableError();
  }
  const occurredAt = new Date();
  const companyId = deterministicUuid(`company-lead-conversion:${lead.id}`);
  registerDemoCompanyDirect(companyId,{
    name: lead.companyName,
    legalName: lead.legalName,
    industry: lead.industry,
    companyInformation: `${lead.employeeRange}; ${lead.branchRange}; ${lead.spendRange}`,
    mainContactName: lead.contactName,
    billingCycle: "Monthly",
    notes: `Converted from ${lead.code}`,
  });
  if (lead.assignment) {
    registerDemoCompanyManagerCoverage(
      companyId,lead.assignment.managerId,actor.name,
      "Acquisition lead handover retained during company conversion",occurredAt,
    );
  }
  lead.convertedCompanyId = companyId;
  lead.status = "ONBOARDING";
  lead.statusVersion += 1;
  lead.updatedAt = occurredAt;
  lead.statusHistory.unshift({
    fromStatus: "QUALIFIED",
    toStatus: "ONBOARDING",
    reason: reason.trim(),
    changedAt: occurredAt,
    changedByName: actor.name,
  });
  return demoStateMutation(lead,"company.lead.converted",occurredAt,companyId);
}

function demoAddCompanyLeadNote(
  actor: AuthenticatedSessionUser,
  leadId: string,
  noteType: "INTERNAL" | "CONTACT_ATTEMPT" | "INFORMATION_RECEIVED",
  note: string,
) {
  const lead = demoCompanyLeadState().leads.get(leadId);
  if (!lead || !demoActorCanFollowUpLead(actor,lead)
    || note.trim().length < 2 || note.trim().length > 5000
    || ["CONVERTED","DUPLICATE","REJECTED","ARCHIVED"].includes(lead.status)) {
    throw new CompanyLeadUnavailableError();
  }
  const occurredAt = new Date();
  const noteId = deterministicUuid(
    `company-lead-note:${lead.id}:${lead.notes.length + 1}:${note.trim()}`,
  );
  lead.notes.unshift({
    id: noteId,
    type: noteType,
    note: note.trim(),
    createdByName: actor.name,
    createdAt: occurredAt,
  });
  lead.updatedAt = occurredAt;
  return demoStateMutation(
    lead,"company.lead.note_added",occurredAt,undefined,noteId,
  );
}

function demoAddCompanyLeadTask(
  actor: AuthenticatedSessionUser,
  leadId: string,
  title: string,
  dueAt: Date,
  assignedUserId: string,
) {
  const lead = demoCompanyLeadState().leads.get(leadId);
  const occurredAt = new Date();
  if (!lead || !demoActorCanFollowUpLead(actor,lead)
    || title.trim().length < 2 || title.trim().length > 240
    || assignedUserId !== DEMO_COMPANY_LEAD_MANAGER.id
    || !Number.isFinite(dueAt.getTime()) || dueAt <= occurredAt
    || ["CONVERTED","DUPLICATE","REJECTED","ARCHIVED"].includes(lead.status)) {
    throw new CompanyLeadUnavailableError();
  }
  const taskId = deterministicUuid(
    `company-lead-task:${lead.id}:${lead.tasks.length + 1}:${title.trim()}`,
  );
  lead.tasks.unshift({
    id: taskId,
    title: title.trim(),
    dueAt: new Date(dueAt),
    status: "OPEN",
    assignedUserId,
    assignedUserName: DEMO_COMPANY_LEAD_MANAGER.name,
    completionNote: null,
  });
  lead.updatedAt = occurredAt;
  return demoStateMutation(
    lead,"company.lead.task_added",occurredAt,undefined,taskId,
  );
}

function demoCompleteCompanyLeadTask(
  actor: AuthenticatedSessionUser,
  leadId: string,
  taskId: string,
  completionNote: string,
) {
  const lead = demoCompanyLeadState().leads.get(leadId);
  const task = lead?.tasks.find((candidate) => candidate.id === taskId);
  if (!lead || !task || !demoActorCanFollowUpLead(actor,lead)
    || task.status !== "OPEN" || completionNote.trim().length > 1000) {
    throw new CompanyLeadUnavailableError();
  }
  const occurredAt = new Date();
  task.status = "COMPLETED";
  task.completionNote = completionNote.trim() || null;
  lead.updatedAt = occurredAt;
  return demoStateMutation(
    lead,"company.lead.task_completed",occurredAt,undefined,taskId,
  );
}

function demoLeadMatchesFilters(
  lead: CompanyLeadRecord,
  actor: AuthenticatedSessionUser,
  filters: Record<string, string | undefined>,
) {
  if (filters.status && lead.status !== filters.status) return false;
  if (filters.source && lead.source !== filters.source) return false;
  if (filters.industry
    && !lead.industry.toLocaleLowerCase().includes(filters.industry.toLocaleLowerCase())) {
    return false;
  }
  if (filters.duplicateRisk && lead.duplicateRisk !== filters.duplicateRisk) return false;
  if (filters.createdFrom) {
    const start = new Date(`${filters.createdFrom}T00:00:00.000Z`);
    if (Number.isFinite(start.getTime()) && lead.createdAt < start) return false;
  }
  if (filters.assignment === "UNASSIGNED" && lead.assignment) return false;
  if (filters.assignment === "MINE" && lead.assignment?.managerId !== actor.id) return false;
  return true;
}

function requiredAssignment(actor: SessionUser) {
  const parsed = uuid.safeParse(actor.roleAssignmentId);
  if (!parsed.success) throw new CompanyLeadUnavailableError();
  return parsed.data;
}

const notificationCopy: Record<SupportedEmailLocale, Record<string, (code: string) => { title: string; body: string }>> = {
  en: {
    "company.lead.submitted": (code) => ({ title: "New company enquiry", body: `${code} is ready for intake review.` }),
    "company.lead.assigned": (code) => ({ title: "Company lead assigned", body: `${code} was assigned for follow-up.` }),
    "company.lead.reassigned": (code) => ({ title: "Company lead reassigned", body: `${code} has a new account manager.` }),
    "company.lead.information_requested": (code) => ({ title: "Lead information requested", body: `${code} is waiting for additional information.` }),
    "company.lead.converted": (code) => ({ title: "Company lead converted", body: `${code} entered company onboarding.` }),
    "company.lead.sla_overdue": (code) => ({ title: "Company lead follow-up overdue", body: `${code} has not been contacted within 24 hours.` }),
  },
  ar: {
    "company.lead.submitted": (code) => ({ title: "استفسار شركة جديد", body: `${code} جاهز لمراجعة فريق الاستقبال.` }),
    "company.lead.assigned": (code) => ({ title: "تم إسناد العميل المحتمل", body: `تم إسناد ${code} للمتابعة.` }),
    "company.lead.reassigned": (code) => ({ title: "أُعيد إسناد العميل المحتمل", body: `لدى ${code} مدير حساب جديد.` }),
    "company.lead.information_requested": (code) => ({ title: "طُلبت معلومات العميل المحتمل", body: `${code} بانتظار معلومات إضافية.` }),
    "company.lead.converted": (code) => ({ title: "تم تحويل العميل المحتمل", body: `انتقل ${code} إلى إعداد الشركة.` }),
    "company.lead.sla_overdue": (code) => ({ title: "تأخرت متابعة العميل المحتمل", body: `لم يتم التواصل بشأن ${code} خلال 24 ساعة.` }),
  },
  ms: {
    "company.lead.submitted": (code) => ({ title: "Pertanyaan syarikat baharu", body: `${code} sedia untuk semakan pengambilan.` }),
    "company.lead.assigned": (code) => ({ title: "Prospek syarikat ditugaskan", body: `${code} ditugaskan untuk tindakan susulan.` }),
    "company.lead.reassigned": (code) => ({ title: "Prospek syarikat ditugaskan semula", body: `${code} mempunyai pengurus akaun baharu.` }),
    "company.lead.information_requested": (code) => ({ title: "Maklumat prospek diminta", body: `${code} sedang menunggu maklumat tambahan.` }),
    "company.lead.converted": (code) => ({ title: "Prospek syarikat ditukar", body: `${code} memasuki proses penerimaan syarikat.` }),
    "company.lead.sla_overdue": (code) => ({ title: "Susulan prospek lewat", body: `${code} belum dihubungi dalam masa 24 jam.` }),
  },
};

function genericNotification(locale: SupportedEmailLocale, code: string) {
  if (locale === "ar") return { title: "تحديث عميل محتمل", body: `تم تحديث ${code}.` };
  if (locale === "ms") return { title: "Kemas kini prospek", body: `${code} telah dikemas kini.` };
  return { title: "Company lead updated", body: `${code} was updated.` };
}

async function notifyCompanyLeadMutation(
  client: PoolClient,
  mutation: Pick<CompanyLeadMutation, "leadId" | "leadCode" | "event" | "notificationRecipientIds">,
) {
  if (!mutation.event.created || mutation.notificationRecipientIds.length === 0) return;
  const recipients = await client.query<{ id: string; locale: SupportedEmailLocale }>(`
    SELECT account.id::text,
      CASE WHEN profile.preferred_locale IN ('en','ar','ms')
        THEN profile.preferred_locale ELSE 'en' END AS locale
    FROM users account
    LEFT JOIN user_profiles profile ON profile.user_id=account.id
    WHERE account.id=ANY($1::uuid[]) AND account.active
      AND account.account_status='ACTIVE'
  `, [mutation.notificationRecipientIds]);
  for (const recipient of recipients.rows) {
    const content = notificationCopy[recipient.locale][mutation.event.eventKey]?.(mutation.leadCode)
      ?? genericNotification(recipient.locale, mutation.leadCode);
    await client.query(`
      SELECT created FROM public.axora_insert_in_app_notification(
        $1,NULL,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10
      )
    `, [
      randomUUID(), recipient.id, mutation.event.id, mutation.event.eventKey,
      `company-lead:${mutation.event.id}`, content.title, content.body,
      mutation.event.eventKey === "company.lead.sla_overdue" ? "HIGH" : "NORMAL",
      `/companies/leads?lead=${encodeURIComponent(mutation.leadId)}`,
      mutation.event.occurredAt,
    ]);
  }
}

function parseMutation(raw: unknown) {
  const parsed = mutationSchema.safeParse(raw);
  if (!parsed.success) throw new CompanyLeadUnavailableError();
  return parsed.data;
}

export async function recordPublicCompanyLead(
  client: PoolClient,
  payload: Record<string, unknown>,
  locale: SupportedEmailLocale,
  capturedAt: Date,
) {
  const result = await client.query<SnapshotRow>(
    "SELECT public.axora_record_public_company_lead($1,$2) AS snapshot",
    [payload, capturedAt],
  );
  const parsed = publicMutationSchema.safeParse(result.rows[0]?.snapshot);
  if (!parsed.success) throw new CompanyLeadUnavailableError();
  const mutation = parsed.data;
  if (mutation.created) {
    await insertContactEmailOutbox(client, mutation.submissionId, locale);
    await insertContactAcknowledgementEmailOutbox(client, mutation.submissionId, locale);
    await notifyCompanyLeadMutation(client, {
      ...mutation,
    });
  }
  return mutation;
}

export async function recordPublicContactSubmission(
  client: PoolClient,
  payload: Record<string, unknown>,
  locale: SupportedEmailLocale,
  capturedAt: Date,
) {
  const result = await client.query<SnapshotRow>(
    "SELECT public.axora_record_public_contact_submission($1,$2) AS snapshot",
    [payload, capturedAt],
  );
  const parsed = publicContactMutationSchema.safeParse(result.rows[0]?.snapshot);
  if (!parsed.success) throw new CompanyLeadUnavailableError();
  const mutation = parsed.data;
  if (mutation.created) {
    await insertContactEmailOutbox(client, mutation.submissionId, locale);
  }
  return mutation;
}

export async function loadCompanyLeadWorkspace(
  actor: AuthenticatedSessionUser,
  filters: Record<string, string | undefined> = {},
  capturedAt = new Date(),
) {
  if (isDemoMode()) {
    const leads = [...demoCompanyLeadState().leads.values()]
      .filter((lead) => actor.isOwner
        || lead.assignment?.managerId === actor.id)
      .filter((lead) => demoLeadMatchesFilters(lead,actor,filters))
      .sort((left,right) => right.createdAt.getTime() - left.createdAt.getTime())
      .map((lead) => demoLeadForActor(lead,actor));
    return {
      capturedAt,
      canViewAll: actor.isOwner,
      managers: actor.isOwner ? [{ ...DEMO_COMPANY_LEAD_MANAGER }] : [],
      leads,
    } satisfies CompanyLeadWorkspace;
  }
  try {
    return await withAuditTransaction(
      { actor, reason: "Viewed authorized company lead workspace" },
      async (client) => {
        const overdue = await client.query<SnapshotRow>(
          "SELECT public.axora_claim_overdue_company_lead_events($1,$2,$3) AS snapshot",
          [actor.id, requiredAssignment(actor), capturedAt],
        );
        const overdueItems = z.array(overdueMutationSchema).safeParse(overdue.rows[0]?.snapshot);
        if (!overdueItems.success) throw new CompanyLeadUnavailableError();
        for (const item of overdueItems.data) {
          await notifyCompanyLeadMutation(client, {
            ...item,
          });
        }
        const result = await client.query<SnapshotRow>(
          "SELECT public.axora_company_lead_workspace($1,$2,$3,$4) AS snapshot",
          [actor.id, requiredAssignment(actor), filters, capturedAt],
        );
        const parsed = workspaceSchema.safeParse(result.rows[0]?.snapshot);
        if (!parsed.success || parsed.data.capturedAt.getTime() !== capturedAt.getTime()) {
          throw new CompanyLeadUnavailableError();
        }
        return parsed.data;
      },
    );
  } catch (error) {
    if (error instanceof CompanyLeadUnavailableError) throw error;
    throw new CompanyLeadUnavailableError();
  }
}

async function mutate(
  actor: AuthenticatedSessionUser,
  reason: string,
  sql: string,
  values: unknown[],
) {
  if (isDemoMode()) throw new CompanyLeadUnavailableError();
  return withAuditTransaction({ actor, reason }, async (client) => {
    const result = await client.query<SnapshotRow>(sql, values);
    const mutation = parseMutation(result.rows[0]?.snapshot);
    await notifyCompanyLeadMutation(client, mutation);
    return mutation;
  });
}

export async function createAcquisitionLead(
  actor: AuthenticatedSessionUser,
  input: AcquisitionLeadInput,
  commandId: string,
  capturedAt = new Date(),
) {
  if (!actor.isOwner || actor.accountKind !== "PLATFORM") {
    throw new CompanyLeadUnavailableError();
  }
  const parsedCommandId = uuid.parse(commandId);
  if (isDemoMode()) {
    return createDemoAcquisitionLead(
      actor,input,parsedCommandId,capturedAt,
    );
  }
  return await mutate(
    actor,
    "Company Lead created by Platform Owner",
    "SELECT public.axora_create_acquisition_lead($1,$2,$3,$4,$5) AS snapshot",
    [
      actor.id,
      requiredAssignment(actor),
      input,
      parsedCommandId,
      capturedAt,
    ],
  );
}

export async function assignCompanyLead(actor: AuthenticatedSessionUser, leadId: string, managerUserId: string, reason: string) {
  const parsedLeadId = uuid.parse(leadId);
  const parsedManagerId = uuid.parse(managerUserId);
  if (isDemoMode()) {
    return demoAssignCompanyLead(actor,parsedLeadId,parsedManagerId,reason);
  }
  return await mutate(actor, "Company lead assigned", "SELECT public.axora_assign_company_lead($1,$2,$3,$4,$5,$6) AS snapshot", [actor.id, requiredAssignment(actor), parsedLeadId, parsedManagerId, reason, new Date()]);
}

export async function transitionCompanyLead(actor: AuthenticatedSessionUser, leadId: string, status: CompanyLeadStatus, reason: string) {
  const parsedLeadId = uuid.parse(leadId);
  if (isDemoMode()) {
    return demoTransitionCompanyLead(actor,parsedLeadId,status,reason);
  }
  return await mutate(actor, `Company lead changed to ${status}`, "SELECT public.axora_transition_company_lead($1,$2,$3,$4,$5,$6) AS snapshot", [actor.id, requiredAssignment(actor), parsedLeadId, status, reason, new Date()]);
}

export function resolveCompanyLeadDuplicate(actor: AuthenticatedSessionUser, leadId: string, candidateId: string, resolution: "CLEAR" | "CONFIRM", reason: string) {
  return mutate(actor, `Company lead duplicate ${resolution.toLowerCase()}`, "SELECT public.axora_resolve_company_lead_duplicate($1,$2,$3,$4,$5,$6,$7) AS snapshot", [actor.id, requiredAssignment(actor), uuid.parse(leadId), uuid.parse(candidateId), resolution, reason, new Date()]);
}

export async function addCompanyLeadNote(actor: AuthenticatedSessionUser, leadId: string, noteType: "INTERNAL" | "CONTACT_ATTEMPT" | "INFORMATION_RECEIVED", note: string) {
  const parsedLeadId = uuid.parse(leadId);
  if (isDemoMode()) {
    return demoAddCompanyLeadNote(actor,parsedLeadId,noteType,note);
  }
  return await mutate(actor, "Company lead note added", "SELECT public.axora_add_company_lead_note($1,$2,$3,$4,$5,$6) AS snapshot", [actor.id, requiredAssignment(actor), parsedLeadId, noteType, note, new Date()]);
}

export async function addCompanyLeadTask(actor: AuthenticatedSessionUser, leadId: string, title: string, dueAt: Date, assignedUserId: string) {
  const parsedLeadId = uuid.parse(leadId);
  const parsedAssignedUserId = uuid.parse(assignedUserId);
  if (isDemoMode()) {
    return demoAddCompanyLeadTask(
      actor,parsedLeadId,title,dueAt,parsedAssignedUserId,
    );
  }
  return await mutate(actor, "Company lead follow-up task added", "SELECT public.axora_add_company_lead_task($1,$2,$3,$4,$5,$6,$7) AS snapshot", [actor.id, requiredAssignment(actor), parsedLeadId, title, dueAt, parsedAssignedUserId, new Date()]);
}

export async function completeCompanyLeadTask(actor: AuthenticatedSessionUser, leadId: string, taskId: string, completionNote: string) {
  const parsedLeadId = uuid.parse(leadId);
  const parsedTaskId = uuid.parse(taskId);
  if (isDemoMode()) {
    return demoCompleteCompanyLeadTask(
      actor,parsedLeadId,parsedTaskId,completionNote,
    );
  }
  return await mutate(actor, "Company lead follow-up task completed", "SELECT public.axora_complete_company_lead_task($1,$2,$3,$4,$5,$6) AS snapshot", [actor.id, requiredAssignment(actor), parsedLeadId, parsedTaskId, completionNote, new Date()]);
}

export async function convertCompanyLead(actor: AuthenticatedSessionUser, leadId: string, reason: string) {
  const parsedLeadId = uuid.parse(leadId);
  if (isDemoMode()) {
    return demoConvertCompanyLead(actor,parsedLeadId,reason);
  }
  return await mutate(actor, "Company lead converted to onboarding company", "SELECT public.axora_convert_company_lead($1,$2,$3,$4,$5) AS snapshot", [actor.id, requiredAssignment(actor), parsedLeadId, reason, new Date()]);
}

export function anonymizeCompanyLead(actor: AuthenticatedSessionUser, leadId: string, reason: string) {
  return mutate(actor, "Company lead anonymized under retention policy", "SELECT public.axora_anonymize_company_lead($1,$2,$3,$4,$5) AS snapshot", [actor.id, requiredAssignment(actor), uuid.parse(leadId), reason, new Date()]);
}

export async function exportCompanyLead(actor: AuthenticatedSessionUser, leadId: string) {
  if (isDemoMode()) throw new CompanyLeadUnavailableError();
  const result = await query<SnapshotRow>(
    "SELECT public.axora_export_company_lead($1,$2,$3,$4) AS snapshot",
    [actor.id, requiredAssignment(actor), uuid.parse(leadId), new Date()],
  );
  const parsed = companyLeadRecordSchema.safeParse(result.rows[0]?.snapshot);
  if (!parsed.success) throw new CompanyLeadUnavailableError();
  const retained = Object.fromEntries(
    Object.entries(parsed.data).filter(([key]) =>
      !retiredCompanyLeadExportKeys.has(key as keyof CompanyLeadRecord)),
  ) as Omit<CompanyLeadRecord,
    "registrationNumber" | "contactEmail" | "phoneCountryCode" | "phone" |
    "country" | "region" | "preferredContactTime" | "usesPersonalEmail">;
  return {
    ...retained,
    duplicateCandidates: retained.duplicateCandidates.map((candidate) => ({
      ...candidate,
      matchedFields: candidate.matchedFields.filter((field) =>
        !retiredCompanyLeadMatchFields.has(field)),
    })),
  };
}
