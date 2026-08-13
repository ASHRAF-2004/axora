import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser, SessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { appendWorkflowEvent, notifyWorkflowUsers } from "./workflow-repository";
import type { WorkflowNotificationMessage } from "./workflow-notification-i18n";

export const COMPANY_ONBOARDING_STEPS = [
  "LEGAL_IDENTITY",
  "INDUSTRY",
  "ADDRESSES",
  "CONTACTS",
  "BILLING",
  "PROCUREMENT",
  "BRAND",
  "ADMINISTRATOR",
  "REVIEW",
] as const;

export const COMPANY_VERIFICATION_STATUSES = [
  "NOT_STARTED",
  "IN_PROGRESS",
  "READY_FOR_REVIEW",
  "VERIFIED",
  "CHANGES_REQUIRED",
] as const;

const uuid = z.string().uuid();
const nullableDate = z.coerce.date().nullable();
const optionalUuid = z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  uuid.optional(),
);
const optionalText = (maximum: number) => z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  z.string().max(maximum).optional(),
);

const companySchema = z.object({
  id: uuid,
  code: z.string().min(1).max(80),
  name: z.string().min(1).max(300),
  status: z.string().min(1).max(80),
  legalName: z.string().max(300),
  registrationNumber: z.string().max(160),
  registrationCountryCode: z.string().regex(/^[A-Z]{2}$/),
  taxRegistrationNumber: z.string().max(160),
  industryCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
  industryOtherText: optionalText(300),
  registeredAddress: z.string().max(5000),
  operatingAddress: z.string().max(5000),
  mainContactName: z.string().max(300),
  mainContactEmail: z.string().max(320),
  mainContactPhone: z.string().max(120),
  billingContactName: z.string().max(300),
  billingContactEmail: z.string().max(320),
  billingContactPhone: z.string().max(120),
  billingAddress: z.string().max(5000),
  billingCycle: z.string().max(300),
  defaultLocale: z.enum(["en", "ar", "ms"]),
  timezone: z.string().min(1).max(120),
  currentStep: z.enum(COMPANY_ONBOARDING_STEPS),
  completedSteps: z.array(z.enum(COMPANY_ONBOARDING_STEPS)),
  version: z.coerce.number().int().positive(),
  savedAt: nullableDate,
  verificationStatus: z.enum(COMPANY_VERIFICATION_STATUSES),
  activationBlockers: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/)),
}).strict();

const itemSchema = z.object({
  id: uuid,
  code: z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/),
  label: z.string().min(2).max(200),
  description: z.string().min(2).max(1000),
  required: z.boolean(),
  status: z.enum(["PENDING", "PASSED", "FAILED", "WAIVED"]),
  responsibleRole: z.enum(["PLATFORM_OWNER", "CLIENT_ACCOUNT_MANAGER", "COMPANY_ADMIN"]),
  responsibleUserId: optionalUuid,
  notes: optionalText(3000),
  evidenceReference: optionalText(1000),
  evidenceMetadata: z.record(z.string(), z.unknown()),
  dueAt: nullableDate.optional(),
  completedAt: nullableDate.optional(),
  exceptionReason: optionalText(1000),
  exceptionApprovedAt: nullableDate.optional(),
  exceptionExpiresAt: nullableDate.optional(),
}).strict();

const historySchema = z.object({
  id: uuid,
  fromStatus: z.enum(COMPANY_VERIFICATION_STATUSES).nullable(),
  toStatus: z.enum(COMPANY_VERIFICATION_STATUSES),
  reason: z.string().min(1).max(1000),
  changedAt: z.coerce.date(),
  changedByName: z.string().max(300).nullable(),
}).strict();

const workspaceSchema = z.object({
  capturedAt: z.coerce.date(),
  canEdit: z.boolean(),
  canApproveExceptions: z.boolean(),
  canVerify: z.boolean(),
  company: companySchema,
  industries: z.array(z.object({
    code: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/),
    nameEn: z.string().min(2).max(160),
    nameAr: z.string().min(2).max(160),
    nameMs: z.string().min(2).max(160),
    allowsCustomLabel: z.boolean(),
  }).strict()),
  responsibleUsers: z.array(z.object({
    id: uuid,
    name: z.string().min(1).max(300),
    email: z.string().min(3).max(320),
  }).strict()),
  items: z.array(itemSchema),
  verificationHistory: z.array(historySchema),
}).strict();

const mutationSchema = z.object({
  companyId: uuid,
  companyName: z.string().min(1).max(300),
  version: z.coerce.number().int().positive(),
  eventKey: z.enum([
    "company.onboarding.updated",
    "company.onboarding.ready",
    "company.onboarding.verified",
  ]),
  notificationRecipientIds: z.array(uuid),
}).strict();

interface SnapshotRow extends QueryResultRow { snapshot: unknown }

export type CompanyOnboardingWorkspace = z.infer<typeof workspaceSchema>;
export type CompanyOnboardingItemStatus = z.infer<typeof itemSchema>["status"];
export type CompanyOnboardingStep = typeof COMPANY_ONBOARDING_STEPS[number];

export interface CompanyOnboardingProfileInput {
  companyId: string;
  expectedVersion: number;
  legalName: string;
  registrationNumber: string;
  registrationCountryCode: string;
  taxRegistrationNumber: string;
  industryCode: string;
  industryOtherText?: string;
  registeredAddress: string;
  operatingAddress: string;
  mainContactName: string;
  mainContactEmail: string;
  mainContactPhone: string;
  billingContactName: string;
  billingContactEmail: string;
  billingContactPhone: string;
  billingAddress: string;
  billingCycle: string;
  defaultLocale: "en" | "ar" | "ms";
  timezone: string;
  currentStep: CompanyOnboardingStep;
  completedSteps: CompanyOnboardingStep[];
  reason: string;
}

export interface CompanyOnboardingItemInput {
  companyId: string;
  expectedVersion: number;
  itemCode: string;
  status: CompanyOnboardingItemStatus;
  responsibleUserId?: string;
  notes?: string;
  evidenceReference?: string;
  dueAt?: Date;
  exceptionReason?: string;
  exceptionExpiresAt?: Date;
  reason: string;
}

const DEMO_ONBOARDING_COMPANY_ID = "10000000-0000-4000-8000-000000000001";

function demoOnboardingWorkspace(companyId: string, capturedAt: Date) {
  if (companyId !== DEMO_ONBOARDING_COMPANY_ID) {
    throw new CompanyOnboardingUnavailableError();
  }
  return workspaceSchema.parse({
    capturedAt,
    canEdit: false,
    canApproveExceptions: false,
    canVerify: false,
    company: {
      id: companyId,
      code: "C-100",
      name: "YourUni",
      status: "ONBOARDING",
      legalName: "YourUni Education Sdn. Bhd.",
      registrationNumber: "DEMO-REG-100",
      registrationCountryCode: "MY",
      taxRegistrationNumber: "",
      industryCode: "EDUCATION",
      registeredAddress: "Cyberjaya, Selangor",
      operatingAddress: "Cyberjaya, Selangor",
      mainContactName: "Company administrator",
      mainContactEmail: "admin@youruni.example",
      mainContactPhone: "+60 00-000 0000",
      billingContactName: "Company administrator",
      billingContactEmail: "billing@youruni.example",
      billingContactPhone: "+60 00-000 0000",
      billingAddress: "Cyberjaya, Selangor",
      billingCycle: "Monthly",
      defaultLocale: "en",
      timezone: "Asia/Kuala_Lumpur",
      currentStep: "REVIEW",
      completedSteps: COMPANY_ONBOARDING_STEPS.filter((step) => step !== "REVIEW"),
      version: 1,
      savedAt: capturedAt,
      verificationStatus: "READY_FOR_REVIEW",
      activationBlockers: ["ONBOARDING_VERIFICATION"],
    },
    industries: [{
      code: "EDUCATION",
      nameEn: "Education",
      nameAr: "التعليم",
      nameMs: "Pendidikan",
      allowsCustomLabel: false,
    }],
    responsibleUsers: [],
    items: [
      {
        id: "10000000-0000-4000-8000-000000000101",
        code: "COMPANY_PROFILE",
        label: "Company profile",
        description: "Legal identity, contacts, billing and timezone are complete.",
        required: true,
        status: "PASSED",
        responsibleRole: "CLIENT_ACCOUNT_MANAGER",
        evidenceMetadata: {},
        completedAt: capturedAt,
      },
      {
        id: "10000000-0000-4000-8000-000000000102",
        code: "LOGO_THEME",
        label: "Reviewed logo theme",
        description: "Accessible portal colours were generated from the reviewed logo.",
        required: true,
        status: "PASSED",
        responsibleRole: "CLIENT_ACCOUNT_MANAGER",
        evidenceMetadata: {},
        completedAt: capturedAt,
      },
      {
        id: "10000000-0000-4000-8000-000000000103",
        code: "INITIAL_CONTROLS",
        label: "Initial branch, budget and approvals",
        description: "The company operating scope and spending controls are ready.",
        required: true,
        status: "PASSED",
        responsibleRole: "CLIENT_ACCOUNT_MANAGER",
        evidenceMetadata: {},
        completedAt: capturedAt,
      },
      {
        id: "10000000-0000-4000-8000-000000000104",
        code: "COMPANY_ADMINISTRATOR",
        label: "Named company administrator",
        description: "A private single-use account invitation is ready for the administrator.",
        required: true,
        status: "PENDING",
        responsibleRole: "CLIENT_ACCOUNT_MANAGER",
        evidenceMetadata: {},
      },
    ],
    verificationHistory: [{
      id: "10000000-0000-4000-8000-000000000105",
      fromStatus: "IN_PROGRESS",
      toStatus: "READY_FOR_REVIEW",
      reason: "Demo onboarding controls completed",
      changedAt: capturedAt,
      changedByName: "Client Account Manager",
    }],
  });
}

export class CompanyOnboardingUnavailableError extends Error {
  constructor() {
    super("The requested company onboarding operation is unavailable.");
    this.name = "CompanyOnboardingUnavailableError";
  }
}

function assignmentId(actor: SessionUser) {
  const parsed = uuid.safeParse(actor.roleAssignmentId);
  if (!parsed.success) throw new CompanyOnboardingUnavailableError();
  return parsed.data;
}

function parseMutation(raw: unknown) {
  const parsed = mutationSchema.safeParse(raw);
  if (!parsed.success) throw new CompanyOnboardingUnavailableError();
  return parsed.data;
}

export async function loadCompanyOnboardingWorkspace(
  actor: AuthenticatedSessionUser,
  companyId: string,
  capturedAt = new Date(),
) {
  if (!Number.isFinite(capturedAt.getTime())) {
    throw new CompanyOnboardingUnavailableError();
  }
  if (isDemoMode()) return demoOnboardingWorkspace(companyId, capturedAt);
  try {
    const result = await query<SnapshotRow>(
      "SELECT public.axora_company_onboarding_workspace($1,$2,$3,$4) AS snapshot",
      [actor.id, assignmentId(actor), uuid.parse(companyId), capturedAt],
    );
    const parsed = workspaceSchema.safeParse(result.rows[0]?.snapshot);
    if (!parsed.success || parsed.data.capturedAt.getTime() !== capturedAt.getTime()) {
      throw new CompanyOnboardingUnavailableError();
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof CompanyOnboardingUnavailableError) throw error;
    throw new CompanyOnboardingUnavailableError();
  }
}

const messages: Record<z.infer<typeof mutationSchema>["eventKey"], (
  companyName: string,
) => WorkflowNotificationMessage> = {
  "company.onboarding.updated": (companyName) => ({
    key: "company_onboarding_updated",
    companyName,
  }),
  "company.onboarding.ready": (companyName) => ({
    key: "company_onboarding_ready",
    companyName,
  }),
  "company.onboarding.verified": (companyName) => ({
    key: "company_onboarding_verified",
    companyName,
  }),
};

async function notifyMutation(
  client: PoolClient,
  mutation: z.infer<typeof mutationSchema>,
  actor: SessionUser,
) {
  if (!mutation.notificationRecipientIds.length) return;
  const event = await appendWorkflowEvent(client, {
    companyId: mutation.companyId,
    aggregateType: "company-onboarding",
    aggregateId: mutation.companyId,
    eventKey: mutation.eventKey,
    stableKey: `${mutation.eventKey}:${mutation.version}`,
    actor,
    source: "WEB",
    metadata: { companyName: mutation.companyName, version: mutation.version },
  });
  await notifyWorkflowUsers(client, event, {
    recipientUserIds: mutation.notificationRecipientIds,
    message: messages[mutation.eventKey](mutation.companyName),
    routePath: `/companies/${mutation.companyId}/onboarding`,
    priority: mutation.eventKey === "company.onboarding.ready" ? "HIGH" : "NORMAL",
  });
}

async function mutate(
  actor: AuthenticatedSessionUser,
  reason: string,
  sql: string,
  values: unknown[],
) {
  if (isDemoMode()) throw new CompanyOnboardingUnavailableError();
  return withAuditTransaction({ actor, reason }, async (client) => {
    const result = await client.query<SnapshotRow>(sql, values);
    const mutation = parseMutation(result.rows[0]?.snapshot);
    await notifyMutation(client, mutation, actor);
    return mutation;
  });
}

export function saveCompanyOnboarding(
  actor: AuthenticatedSessionUser,
  input: CompanyOnboardingProfileInput,
) {
  return mutate(
    actor,
    input.reason,
    `SELECT public.axora_save_company_onboarding(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
       $19,$20,$21,$22,$23,$24,$25,$26
     ) AS snapshot`,
    [
      actor.id, assignmentId(actor), uuid.parse(input.companyId), input.expectedVersion,
      input.legalName, input.registrationNumber, input.registrationCountryCode,
      input.taxRegistrationNumber, input.industryCode, input.industryOtherText ?? null,
      input.registeredAddress, input.operatingAddress, input.mainContactName,
      input.mainContactEmail, input.mainContactPhone, input.billingContactName,
      input.billingContactEmail, input.billingContactPhone, input.billingAddress,
      input.billingCycle, input.defaultLocale, input.timezone, input.currentStep,
      input.completedSteps, input.reason, new Date(),
    ],
  );
}

export function updateCompanyOnboardingItem(
  actor: AuthenticatedSessionUser,
  input: CompanyOnboardingItemInput,
) {
  return mutate(
    actor,
    input.reason,
    `SELECT public.axora_update_company_onboarding_item(
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14
     ) AS snapshot`,
    [
      actor.id, assignmentId(actor), uuid.parse(input.companyId), input.expectedVersion,
      input.itemCode, input.status, input.responsibleUserId ?? null, input.notes ?? null,
      input.evidenceReference ?? null, input.dueAt ?? null, input.exceptionReason ?? null,
      input.exceptionExpiresAt ?? null, input.reason, new Date(),
    ],
  );
}

export function verifyCompanyOnboarding(
  actor: AuthenticatedSessionUser,
  companyId: string,
  expectedVersion: number,
  reason: string,
) {
  return mutate(
    actor,
    reason,
    "SELECT public.axora_verify_company_onboarding($1,$2,$3,$4,$5,$6) AS snapshot",
    [actor.id, assignmentId(actor), uuid.parse(companyId), expectedVersion, reason, new Date()],
  );
}

export const companyOnboardingInternals = { mutationSchema, workspaceSchema };
