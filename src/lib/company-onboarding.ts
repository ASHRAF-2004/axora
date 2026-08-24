import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser, SessionUser } from "./auth";
import { isDemoMode, query, withAuditTransaction } from "./db";
import { getDemoStore } from "./demo-data";
import {
  approveDemoCompanyVerification,
  demoCompanyActivationState,
} from "./demo-company-activation";
import { canAccess } from "./permissions";
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
  "DRAFT",
  "PENDING_VERIFICATION",
  "CHANGES_REQUESTED",
  "VERIFIED",
  "REJECTED",
  "INACTIVE",
] as const;

const COMPANY_VERIFICATION_HISTORY_STATUSES = [
  ...COMPANY_VERIFICATION_STATUSES,
  "NOT_STARTED",
  "IN_PROGRESS",
  "READY_FOR_REVIEW",
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
  companyInformation: z.string().max(5000),
  websiteUrl: optionalText(2048),
  internalNotes: optionalText(5000),
  createdBy: optionalUuid,
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
  fromStatus: z.enum(COMPANY_VERIFICATION_HISTORY_STATUSES).nullable(),
  toStatus: z.enum(COMPANY_VERIFICATION_HISTORY_STATUSES),
  reason: z.string().min(1).max(1000),
  changedAt: z.coerce.date(),
  changedByName: z.string().max(300).nullable(),
}).strict();

const workspaceSchema = z.object({
  capturedAt: z.coerce.date(),
  canEdit: z.boolean(),
  canApproveExceptions: z.boolean(),
  canVerify: z.boolean(),
  canReview: z.boolean(),
  canSubmit: z.boolean(),
  canRequestChanges: z.boolean(),
  canReject: z.boolean(),
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
    "company.verification.submitted",
    "company.verification.approved",
    "company.verification.changes_requested",
    "company.verification.rejected",
  ]),
  notificationRecipientIds: z.array(uuid),
}).strict();

const verificationApprovalResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("VERIFIED"), mutation: mutationSchema }).strict(),
  z.object({
    status: z.literal("BLOCKED"),
    blockedReasons: z.array(z.string().regex(/^[A-Z][A-Z0-9_]{2,79}$/)),
  }).strict(),
  z.object({ status: z.literal("STALE") }).strict(),
  z.object({ status: z.literal("ALREADY_VERIFIED") }).strict(),
  z.object({ status: z.literal("UNAVAILABLE") }).strict(),
  z.object({ status: z.literal("DENIED") }).strict(),
]);

interface SnapshotRow extends QueryResultRow { snapshot: unknown }

export type CompanyOnboardingWorkspace = z.infer<typeof workspaceSchema>;
export type CompanyOnboardingItemStatus = z.infer<typeof itemSchema>["status"];
export type CompanyOnboardingStep = typeof COMPANY_ONBOARDING_STEPS[number];
export type CompanyVerificationApprovalResult = z.infer<
  typeof verificationApprovalResultSchema
>;

export interface CompanyOnboardingProfileInput {
  companyId: string;
  expectedVersion: number;
  legalName: string;
  registrationCountryCode: string;
  taxRegistrationNumber: string;
  industryCode: string;
  industryOtherText?: string;
  registeredAddress: string;
  operatingAddress: string;
  mainContactName: string;
  billingContactName: string;
  billingContactEmail: string;
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
type DemoSetup = {
  legalName: string;
  mainContactName: string;
  industryCode: string;
  defaultLocale: "en" | "ar" | "ms";
  timezone: string;
  version: number;
};
const demoSetups = new Map<string, DemoSetup>([[DEMO_ONBOARDING_COMPANY_ID, {
  legalName: "YourUni Education Sdn. Bhd.",
  mainContactName: "Company administrator",
  industryCode: "EDUCATION",
  defaultLocale: "en",
  timezone: "Asia/Kuala_Lumpur",
  version: 1,
}]]);

function demoSetupFor(companyId: string) {
  const existing = demoSetups.get(companyId);
  if (existing) return existing;
  const company = getDemoStore().companies.find((item) => item.id === companyId);
  if (!company) throw new CompanyOnboardingUnavailableError();
  const industryCode = (company.industry || "OTHER").normalize("NFKC")
    .toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const setup: DemoSetup = {
    legalName: company.name,
    mainContactName: company.mainContactName || "Main contact",
    industryCode: /^[A-Z][A-Z0-9_]{1,63}$/.test(industryCode) ? industryCode : "OTHER",
    defaultLocale: "en",
    timezone: "Asia/Kuala_Lumpur",
    version: 1,
  };
  demoSetups.set(companyId, setup);
  return setup;
}

function demoOnboardingWorkspace(actor: AuthenticatedSessionUser, companyId: string, capturedAt: Date) {
  const demoCompany = getDemoStore().companies.find((item) => item.id === companyId);
  const setup = demoSetupFor(companyId);
  return workspaceSchema.parse({
    capturedAt,
    canEdit: canAccess(actor, "manage_companies"),
    canApproveExceptions: false,
    canVerify: false,
    canReview: false,
    canSubmit: false,
    canRequestChanges: false,
    canReject: false,
    company: {
      id: companyId,
      code: demoCompany?.code ?? "C-100",
      name: demoCompany?.name ?? "YourUni",
      companyInformation: "Demo education company",
      status: "ONBOARDING",
      legalName: setup.legalName,
      registrationNumber: "DEMO-REG-100",
      registrationCountryCode: "MY",
      taxRegistrationNumber: "",
      industryCode: setup.industryCode,
      registeredAddress: "Cyberjaya, Selangor",
      operatingAddress: "Cyberjaya, Selangor",
      mainContactName: setup.mainContactName,
      mainContactEmail: "admin@youruni.example",
      mainContactPhone: "+60 00-000 0000",
      billingContactName: "Company administrator",
      billingContactEmail: "billing@youruni.example",
      billingContactPhone: "+60 00-000 0000",
      billingAddress: "Cyberjaya, Selangor",
      billingCycle: "Monthly",
      defaultLocale: setup.defaultLocale,
      timezone: setup.timezone,
      currentStep: "REVIEW",
      completedSteps: COMPANY_ONBOARDING_STEPS.filter((step) => step !== "REVIEW"),
      version: setup.version,
      savedAt: capturedAt,
      verificationStatus: "PENDING_VERIFICATION",
      activationBlockers: ["ONBOARDING_VERIFICATION"],
    },
    industries: [{
      code: setup.industryCode,
      nameEn: demoCompany?.industry || "Education",
      nameAr: demoCompany?.industry || "التعليم",
      nameMs: demoCompany?.industry || "Pendidikan",
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
      fromStatus: "DRAFT",
      toStatus: "PENDING_VERIFICATION",
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
  if (isDemoMode()) return demoOnboardingWorkspace(actor, companyId, capturedAt);
  try {
    const result = await query<SnapshotRow>(
      "SELECT public.axora_company_verification_workspace($1,$2,$3,$4) AS snapshot",
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
  "company.verification.submitted": (companyName) => ({
    key: "company_verification_submitted",
    companyName,
  }),
  "company.verification.approved": (companyName) => ({
    key: "company_verification_approved",
    companyName,
  }),
  "company.verification.changes_requested": (companyName) => ({
    key: "company_verification_changes_requested",
    companyName,
  }),
  "company.verification.rejected": (companyName) => ({
    key: "company_verification_rejected",
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
    priority: mutation.eventKey === "company.verification.submitted" ? "HIGH" : "NORMAL",
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

export async function saveCompanyOnboarding(
  actor: AuthenticatedSessionUser,
  input: CompanyOnboardingProfileInput,
) {
  if (isDemoMode()) {
    const setup = demoSetupFor(input.companyId);
    if (!canAccess(actor, "manage_companies")
      || input.expectedVersion !== setup.version) {
      throw new CompanyOnboardingUnavailableError();
    }
    setup.legalName = input.legalName;
    setup.mainContactName = input.mainContactName;
    setup.industryCode = input.industryCode;
    setup.defaultLocale = input.defaultLocale;
    setup.timezone = input.timezone;
    setup.version += 1;
    const companyName = getDemoStore().companies.find((item) => item.id === input.companyId)?.name ?? "YourUni";
    return mutationSchema.parse({
      companyId: input.companyId,
      companyName,
      version: setup.version,
      eventKey: "company.onboarding.updated",
      notificationRecipientIds: [],
    });
  }
  const capturedAt = new Date();
  return withAuditTransaction({ actor, reason: input.reason }, async (client) => {
    // The current database signature retains these historical columns so an
    // older application image can still roll back safely. Read their trusted
    // values server-side and pass them through unchanged; they are no longer
    // collected, displayed, or accepted from the browser.
    const currentResult = await client.query<SnapshotRow>(
      "SELECT public.axora_company_verification_workspace($1,$2,$3,$4) AS snapshot",
      [actor.id, assignmentId(actor), uuid.parse(input.companyId), capturedAt],
    );
    const current = workspaceSchema.safeParse(currentResult.rows[0]?.snapshot);
    if (!current.success
      || current.data.capturedAt.getTime() !== capturedAt.getTime()
      || current.data.company.id !== input.companyId
      || current.data.company.version !== input.expectedVersion) {
      throw new CompanyOnboardingUnavailableError();
    }
    const result = await client.query<SnapshotRow>(
      `SELECT public.axora_save_company_verification_draft(
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
         $19,$20,$21,$22,$23,$24,$25,$26
       ) AS snapshot`,
      [
        actor.id, assignmentId(actor), uuid.parse(input.companyId), input.expectedVersion,
        input.legalName, current.data.company.registrationNumber,
        input.registrationCountryCode, input.taxRegistrationNumber,
        input.industryCode, input.industryOtherText ?? null,
        input.registeredAddress, input.operatingAddress, input.mainContactName,
        current.data.company.mainContactEmail, current.data.company.mainContactPhone,
        input.billingContactName, input.billingContactEmail,
        current.data.company.billingContactPhone, input.billingAddress, input.billingCycle,
        input.defaultLocale, input.timezone, input.currentStep,
        input.completedSteps, input.reason, capturedAt,
      ],
    );
    const mutation = parseMutation(result.rows[0]?.snapshot);
    await notifyMutation(client, mutation, actor);
    return mutation;
  });
}

export function updateCompanyOnboardingItem(
  actor: AuthenticatedSessionUser,
  input: CompanyOnboardingItemInput,
) {
  return mutate(
    actor,
    input.reason,
    `SELECT public.axora_update_company_verification_item(
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

export function submitCompanyVerification(
  actor: AuthenticatedSessionUser,
  companyId: string,
  expectedVersion: number,
  reason: string,
) {
  return mutate(
    actor,
    reason,
    "SELECT public.axora_submit_company_verification($1,$2,$3,$4,$5,$6) AS snapshot",
    [actor.id, assignmentId(actor), uuid.parse(companyId), expectedVersion, reason, new Date()],
  );
}

export function reviewCompanyVerification(
  actor: AuthenticatedSessionUser,
  companyId: string,
  expectedVersion: number,
  decision: "APPROVE" | "REQUEST_CHANGES" | "REJECT",
  reason: string,
) {
  return mutate(
    actor,
    reason,
    "SELECT public.axora_review_company_verification($1,$2,$3,$4,$5,$6,$7) AS snapshot",
    [
      actor.id, assignmentId(actor), uuid.parse(companyId), expectedVersion,
      decision, reason, new Date(),
    ],
  );
}

export function approveCompanyVerification(
  actor: AuthenticatedSessionUser,
  companyId: string,
  expectedVersion: number,
): Promise<CompanyVerificationApprovalResult> {
  if (isDemoMode()) {
    if (!actor.isOwner || actor.accountKind !== "PLATFORM") {
      return Promise.resolve({ status: "DENIED" });
    }
    const outcome = approveDemoCompanyVerification(
      actor.id,
      companyId,
      expectedVersion,
    );
    if (outcome !== "VERIFIED") return Promise.resolve({ status: outcome });
    const company = getDemoStore().companies.find((item) => item.id === companyId);
    const state = demoCompanyActivationState(actor.id, companyId);
    if (!company || !state) return Promise.resolve({ status: "UNAVAILABLE" });
    return Promise.resolve({
      status: "VERIFIED",
      mutation: mutationSchema.parse({
        companyId,
        companyName: company.name,
        version: state.verificationVersion,
        eventKey: "company.verification.approved",
        notificationRecipientIds: [],
      }),
    });
  }
  const reason = "COMPANY_VERIFICATION_APPROVED";
  return withAuditTransaction({ actor, reason }, async (client) => {
    const result = await client.query<SnapshotRow>(
      `SELECT public.axora_review_company_verification(
         $1,$2,$3,$4,$5,$6,$7,$8
       ) AS snapshot`,
      [
        actor.id,
        assignmentId(actor),
        actor.authVersion,
        uuid.parse(companyId),
        z.coerce.number().int().positive().parse(expectedVersion),
        "APPROVE",
        reason,
        new Date(),
      ],
    );
    const parsed = verificationApprovalResultSchema.safeParse(
      result.rows[0]?.snapshot,
    );
    if (!parsed.success) throw new CompanyOnboardingUnavailableError();
    if (parsed.data.status === "VERIFIED") {
      await notifyMutation(client, parsed.data.mutation, actor);
    }
    return parsed.data;
  });
}

export const companyOnboardingInternals = { mutationSchema, workspaceSchema };
