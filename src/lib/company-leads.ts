import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser, SessionUser } from "./auth";
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
  contactEmail: z.string().trim().min(3).max(254),
  phoneCountryCode: z.string().max(12),
  phone: z.string().trim().min(3).max(40),
  country: z.string().trim().min(2).max(120),
  region: z.string().trim().min(2).max(160),
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
  consentAt: z.coerce.date(),
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

export class CompanyLeadUnavailableError extends Error {
  constructor() {
    super("The requested company lead operation is unavailable.");
    this.name = "CompanyLeadUnavailableError";
  }
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
      INSERT INTO in_app_notifications(
        id,company_id,recipient_user_id,workflow_event_id,lead_event_id,
        event_key,dedupe_key,title,body,priority,route_path,created_at
      ) VALUES ($1,NULL,$2,NULL,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT DO NOTHING
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

export async function loadCompanyLeadWorkspace(
  actor: AuthenticatedSessionUser,
  filters: Record<string, string | undefined> = {},
  capturedAt = new Date(),
) {
  if (isDemoMode()) return { capturedAt, canViewAll: actor.isOwner, managers: [], leads: [] };
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

export function assignCompanyLead(actor: AuthenticatedSessionUser, leadId: string, managerUserId: string, reason: string) {
  return mutate(actor, "Company lead assigned", "SELECT public.axora_assign_company_lead($1,$2,$3,$4,$5,$6) AS snapshot", [actor.id, requiredAssignment(actor), uuid.parse(leadId), uuid.parse(managerUserId), reason, new Date()]);
}

export function transitionCompanyLead(actor: AuthenticatedSessionUser, leadId: string, status: CompanyLeadStatus, reason: string) {
  return mutate(actor, `Company lead changed to ${status}`, "SELECT public.axora_transition_company_lead($1,$2,$3,$4,$5,$6) AS snapshot", [actor.id, requiredAssignment(actor), uuid.parse(leadId), status, reason, new Date()]);
}

export function resolveCompanyLeadDuplicate(actor: AuthenticatedSessionUser, leadId: string, candidateId: string, resolution: "CLEAR" | "CONFIRM", reason: string) {
  return mutate(actor, `Company lead duplicate ${resolution.toLowerCase()}`, "SELECT public.axora_resolve_company_lead_duplicate($1,$2,$3,$4,$5,$6,$7) AS snapshot", [actor.id, requiredAssignment(actor), uuid.parse(leadId), uuid.parse(candidateId), resolution, reason, new Date()]);
}

export function addCompanyLeadNote(actor: AuthenticatedSessionUser, leadId: string, noteType: "INTERNAL" | "CONTACT_ATTEMPT" | "INFORMATION_RECEIVED", note: string) {
  return mutate(actor, "Company lead note added", "SELECT public.axora_add_company_lead_note($1,$2,$3,$4,$5,$6) AS snapshot", [actor.id, requiredAssignment(actor), uuid.parse(leadId), noteType, note, new Date()]);
}

export function addCompanyLeadTask(actor: AuthenticatedSessionUser, leadId: string, title: string, dueAt: Date, assignedUserId: string) {
  return mutate(actor, "Company lead follow-up task added", "SELECT public.axora_add_company_lead_task($1,$2,$3,$4,$5,$6,$7) AS snapshot", [actor.id, requiredAssignment(actor), uuid.parse(leadId), title, dueAt, uuid.parse(assignedUserId), new Date()]);
}

export function completeCompanyLeadTask(actor: AuthenticatedSessionUser, leadId: string, taskId: string, completionNote: string) {
  return mutate(actor, "Company lead follow-up task completed", "SELECT public.axora_complete_company_lead_task($1,$2,$3,$4,$5,$6) AS snapshot", [actor.id, requiredAssignment(actor), uuid.parse(leadId), uuid.parse(taskId), completionNote, new Date()]);
}

export function convertCompanyLead(actor: AuthenticatedSessionUser, leadId: string, reason: string) {
  return mutate(actor, "Company lead converted to onboarding company", "SELECT public.axora_convert_company_lead($1,$2,$3,$4,$5) AS snapshot", [actor.id, requiredAssignment(actor), uuid.parse(leadId), reason, new Date()]);
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
  return parsed.data;
}
