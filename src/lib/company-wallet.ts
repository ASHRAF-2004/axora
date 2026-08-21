import type { QueryResultRow } from "pg";
import { z } from "zod";

import type { AuthenticatedSessionUser } from "./auth";
import { getDemoStore } from "./demo-data";
import { isDemoMode, query, withAuditTransaction } from "./db";
import {
  APPROVE_AND_PAY_RESULT_STATUSES,
  TOP_UP_STATUSES,
  type ApproveAndPayResult,
  type TopUpRecordResult,
  type TopUpRequestResult,
} from "./finance-business-results";
import {
  moneyDecimalFromMinorUnits,
  moneyDecimalToMinorUnits,
  parseMoneyDecimal,
  parsePositiveMoneyDecimal,
  safeParseMoneyDecimal,
  type MoneyDecimalString,
} from "./money-decimal";
import { canAccess } from "./permissions";

const uuid = z.string().uuid();
const currency = z.string().regex(/^[A-Z]{3}$/);
const safeText = (minimum: number, maximum: number) => z.string()
  .trim()
  .min(minimum)
  .max(maximum)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));
const optionalText = (maximum: number) => z.string()
  .trim()
  .max(maximum)
  .refine((value) => !/[\u0000-\u001f\u007f]/.test(value))
  .optional();
const moneySchema = z.string().transform((value, context): MoneyDecimalString => {
  const parsed = safeParseMoneyDecimal(value, { allowNegative: true });
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: `Invalid money value: ${parsed.error}` });
    return z.NEVER;
  }
  return parsed.value;
});
const positiveMoneySchema = z.string().transform((value, context): MoneyDecimalString => {
  const parsed = safeParseMoneyDecimal(value, { allowNegative: false, allowZero: false });
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: `Invalid positive money value: ${parsed.error}` });
    return z.NEVER;
  }
  return parsed.value;
});
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});

const topUpRequestSchema = z.object({
  id: uuid,
  amount: positiveMoneySchema,
  currency,
  reference: z.string().nullable(),
  note: z.string().nullable(),
  status: z.enum(TOP_UP_STATUSES),
  requestedBy: uuid,
  requestedAt: z.coerce.date(),
  processedAt: z.coerce.date().nullable(),
});
const ledgerEntrySchema = z.object({
  id: uuid,
  type: z.enum(["TOP_UP", "PAYMENT", "REFUND", "ADJUSTMENT"]),
  amountDelta: moneySchema,
  currency,
  effectiveDate: isoDate,
  reference: z.string(),
  reason: z.string(),
  requestId: uuid.nullable(),
  invoiceId: uuid.nullable(),
  postedAt: z.coerce.date(),
  actorUserId: uuid,
});
const walletSchema = z.object({
  companyId: uuid,
  companyName: z.string().trim().min(1),
  currency,
  availableBalance: moneySchema,
  canRequestTopUp: z.boolean(),
  canRecordTopUp: z.boolean(),
  topUpRequests: z.array(topUpRequestSchema),
  ledger: z.array(ledgerEntrySchema),
});
const walletWorkspaceSchema = z.object({
  capturedAt: z.coerce.date(),
  wallets: z.array(walletSchema),
});
const topUpRequestResultSchema = z.object({
  created: z.boolean(),
  requestId: uuid,
  status: z.enum(TOP_UP_STATUSES),
  amount: positiveMoneySchema,
  currency,
  workflowEventId: uuid.optional(),
});
const topUpRecordResultSchema = z.object({
  created: z.boolean(),
  status: z.literal("RECEIVED"),
  topUpRequestId: uuid.nullable().optional(),
  ledgerEntryId: uuid,
  amount: positiveMoneySchema,
  currency,
  workflowEventId: uuid.optional(),
}).transform((value): TopUpRecordResult => ({
  created: value.created,
  status: value.status,
  ...(value.topUpRequestId ? { topUpRequestId: value.topUpRequestId } : {}),
  ledgerEntryId: value.ledgerEntryId,
  amount: value.amount,
  currency: value.currency,
  ...(value.workflowEventId ? { workflowEventId: value.workflowEventId } : {}),
}));

const settledApproveAndPaySchema = z.object({
  status: z.enum(["SUCCESS", "ALREADY_PROCESSED"]),
  commandId: uuid,
  requestId: uuid,
  invoiceId: uuid,
  amount: positiveMoneySchema,
  currency,
  created: z.boolean(),
  correlationId: uuid,
});
const insufficientApproveAndPaySchema = z.object({
  status: z.enum(["INSUFFICIENT_WALLET", "INSUFFICIENT_BUDGET"]),
  commandId: uuid,
  requestId: uuid,
  requiredAmount: positiveMoneySchema,
  availableAmount: moneySchema,
  currency,
  correlationId: uuid.optional(),
});
const staleApproveAndPaySchema = z.object({
  status: z.literal("STALE_REQUEST"),
  commandId: uuid,
  requestId: uuid,
  expectedRevision: z.number().int().positive(),
  currentRevision: z.number().int().positive(),
  correlationId: uuid.optional(),
});
const notReadyApproveAndPaySchema = z.object({
  status: z.literal("NOT_READY"),
  commandId: uuid,
  requestId: uuid,
  requestState: z.string().min(1),
  correlationId: uuid.optional(),
});
const approveAndPayResultSchema = z.discriminatedUnion("status", [
  settledApproveAndPaySchema,
  insufficientApproveAndPaySchema,
  staleApproveAndPaySchema,
  notReadyApproveAndPaySchema,
]);

const requestTopUpInputSchema = z.object({
  companyId: z.string().min(1),
  amount: positiveMoneySchema,
  reference: optionalText(200),
  note: optionalText(1_000),
  commandId: uuid,
});
const recordTopUpInputSchema = z.object({
  companyId: z.string().min(1),
  topUpRequestId: z.string().min(1).optional(),
  amount: positiveMoneySchema,
  effectiveDate: isoDate,
  reference: safeText(3, 200),
  reason: safeText(3, 1_000),
  commandId: uuid,
});
const approveAndPayInputSchema = z.object({
  requestId: z.string().min(1),
  expectedApprovalRevision: z.number().int().positive(),
  reason: safeText(3, 1_000),
  commandId: uuid,
});

interface PayloadRow extends QueryResultRow { payload: unknown }

export type CompanyWalletTopUpRequest = z.infer<typeof topUpRequestSchema>;
export type CompanyWalletLedgerEntry = z.infer<typeof ledgerEntrySchema>;
export type CompanyWallet = z.infer<typeof walletSchema>;
export type CompanyWalletWorkspace = z.infer<typeof walletWorkspaceSchema>;
export type RequestCompanyWalletTopUpInput = z.input<typeof requestTopUpInputSchema>;
export type RecordCompanyWalletTopUpInput = z.input<typeof recordTopUpInputSchema>;
export type ApproveAndPayInput = z.input<typeof approveAndPayInputSchema>;

export class CompanyWalletUnavailableError extends Error {
  constructor() {
    super("The Company Wallet operation is unavailable.");
    this.name = "CompanyWalletUnavailableError";
  }
}

export class CompanyWalletValidationError extends Error {
  constructor() {
    super("The Company Wallet submission is invalid.");
    this.name = "CompanyWalletValidationError";
  }
}

function assignmentId(actor: AuthenticatedSessionUser) {
  const parsed = uuid.safeParse(actor.roleAssignmentId);
  if (!parsed.success) throw new CompanyWalletUnavailableError();
  return parsed.data;
}

function productionUuid(value: string) {
  const parsed = uuid.safeParse(value);
  if (!parsed.success) throw new CompanyWalletValidationError();
  return parsed.data;
}

function validated<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new CompanyWalletValidationError();
  return parsed.data;
}

type DemoCommandRecord<Result> = {
  fingerprint: string;
  result: Result;
};

type DemoTopUpRequestRecord = {
  companyId: string;
  request: CompanyWalletTopUpRequest;
};

type DemoLedgerEntryRecord = {
  companyId: string;
  entry: CompanyWalletLedgerEntry;
};

type DemoFinanceState = {
  version: 2;
  balances: Map<string, MoneyDecimalString>;
  requests: Map<string, DemoTopUpRequestRecord>;
  ledger: Map<string, DemoLedgerEntryRecord>;
  topUpLedgerByRequest: Map<string, string>;
  invoiceIdsByRequest: Map<string, string>;
  requestCommands: Map<string, DemoCommandRecord<TopUpRequestResult>>;
  recordCommands: Map<string, DemoCommandRecord<TopUpRecordResult>>;
  approveCommands: Map<string, DemoCommandRecord<ApproveAndPayResult>>;
};

declare global {
  var __axoraDemoFinanceState: DemoFinanceState | undefined;
}

function demoFinanceState() {
  if (!global.__axoraDemoFinanceState
    || global.__axoraDemoFinanceState.version !== 2) {
    const balances = new Map<string, MoneyDecimalString>();
    for (const company of getDemoStore().companies) {
      balances.set(company.id, parseMoneyDecimal("100000.00"));
    }
    global.__axoraDemoFinanceState = {
      version: 2,
      balances,
      requests: new Map(),
      ledger: new Map(),
      topUpLedgerByRequest: new Map(),
      invoiceIdsByRequest: new Map(),
      requestCommands: new Map(),
      recordCommands: new Map(),
      approveCommands: new Map(),
    };
  }
  return global.__axoraDemoFinanceState;
}

function demoCommandFingerprint(parts: readonly unknown[]) {
  return JSON.stringify(parts);
}

function replayDemoCommand<Result>(
  command: DemoCommandRecord<Result> | undefined,
  fingerprint: string,
) {
  if (!command) return undefined;
  if (command.fingerprint !== fingerprint) {
    throw new CompanyWalletUnavailableError();
  }
  return command.result;
}

function freezeDemoResult<Result extends object>(result: Result): Result {
  return Object.freeze(result);
}

function demoCompanyAllowed(actor: AuthenticatedSessionUser, companyId: string) {
  return actor.isOwner || (actor.accountKind === "COMPANY" && actor.companyId === companyId);
}

function demoWorkspace(actor: AuthenticatedSessionUser, companyId?: string): CompanyWalletWorkspace {
  const state = demoFinanceState();
  const capturedAt = new Date();
  const companies = getDemoStore().companies.filter((company) => (
    (!companyId || company.id === companyId) && demoCompanyAllowed(actor, company.id)
  ));
  return {
    capturedAt,
    wallets: companies.map((company) => ({
      companyId: company.id,
      companyName: company.name,
      currency: "MYR",
      availableBalance: state.balances.get(company.id) ?? parseMoneyDecimal("0.00"),
      canRequestTopUp: actor.accountKind === "COMPANY"
        && canAccess(actor, "request_wallet_top_up"),
      canRecordTopUp: actor.isOwner && canAccess(actor, "record_wallet_top_up"),
      topUpRequests: [...state.requests.values()]
        .filter((record) => record.companyId === company.id)
        .map((record) => ({
          ...record.request,
          requestedAt: new Date(record.request.requestedAt),
          processedAt: record.request.processedAt
            ? new Date(record.request.processedAt)
            : null,
        }))
        .sort((left, right) => right.requestedAt.getTime() - left.requestedAt.getTime()),
      ledger: [...state.ledger.values()]
        .filter((record) => record.companyId === company.id)
        .map((record) => ({
          ...record.entry,
          postedAt: new Date(record.entry.postedAt),
        }))
        .sort((left, right) => right.postedAt.getTime() - left.postedAt.getTime()),
    })),
  };
}

function parseApproveAndPayResult(value: unknown): ApproveAndPayResult {
  const parsed = approveAndPayResultSchema.safeParse(value);
  if (!parsed.success
    || !(APPROVE_AND_PAY_RESULT_STATUSES as readonly string[]).includes(parsed.data.status)) {
    throw new CompanyWalletUnavailableError();
  }
  if (parsed.data.status === "SUCCESS" && parsed.data.created !== true) {
    throw new CompanyWalletUnavailableError();
  }
  if (parsed.data.status === "ALREADY_PROCESSED" && parsed.data.created !== false) {
    throw new CompanyWalletUnavailableError();
  }
  return parsed.data as ApproveAndPayResult;
}

export async function getCompanyWalletWorkspace(
  actor: AuthenticatedSessionUser,
  companyId?: string,
): Promise<CompanyWalletWorkspace> {
  if (isDemoMode()) return demoWorkspace(actor, companyId);
  const selectedCompanyId = companyId ? productionUuid(companyId) : null;
  try {
    const result = await query<PayloadRow>(
      "SELECT public.axora_company_wallet_workspace($1,$2,$3,now()) AS payload",
      [actor.id, assignmentId(actor), selectedCompanyId],
    );
    const parsed = walletWorkspaceSchema.safeParse(result.rows[0]?.payload);
    if (!parsed.success) throw new CompanyWalletUnavailableError();
    return parsed.data;
  } catch (error) {
    if (error instanceof CompanyWalletValidationError
      || error instanceof CompanyWalletUnavailableError) throw error;
    throw new CompanyWalletUnavailableError();
  }
}

export async function requestCompanyWalletTopUp(
  actor: AuthenticatedSessionUser,
  value: RequestCompanyWalletTopUpInput,
): Promise<TopUpRequestResult> {
  const input = validated(requestTopUpInputSchema, value);
  if (isDemoMode()) {
    if (!demoCompanyAllowed(actor, input.companyId)
      || actor.accountKind !== "COMPANY"
      || !canAccess(actor, "request_wallet_top_up")) {
      throw new CompanyWalletUnavailableError();
    }
    const state = demoFinanceState();
    const fingerprint = demoCommandFingerprint([
      actor.id,
      input.companyId,
      input.amount,
      input.reference ?? null,
      input.note ?? null,
    ]);
    const prior = replayDemoCommand(
      state.requestCommands.get(input.commandId),
      fingerprint,
    );
    if (prior) return prior;
    const requestedAt = new Date();
    const result = freezeDemoResult<TopUpRequestResult>({
      created: true,
      requestId: input.commandId,
      status: "REQUESTED",
      amount: input.amount,
      currency: "MYR",
    });
    const request = freezeDemoResult<CompanyWalletTopUpRequest>({
      id: result.requestId,
      amount: input.amount,
      currency: "MYR",
      reference: input.reference ?? null,
      note: input.note ?? null,
      status: "REQUESTED",
      requestedBy: actor.id,
      requestedAt,
      processedAt: null,
    });
    state.requestCommands.set(input.commandId, { fingerprint, result });
    state.requests.set(result.requestId, { companyId: input.companyId, request });
    return result;
  }
  const companyId = productionUuid(input.companyId);
  try {
    return await withAuditTransaction({
      actor,
      reason: "Company Wallet top-up requested",
      reasonCode: "wallet.top_up.request",
      commandId: input.commandId,
    }, async (client) => {
      const result = await client.query<PayloadRow>(
        `SELECT public.axora_request_company_wallet_top_up(
           $1,$2,$3,$4,$5,$6,$7,now()
         ) AS payload`,
        [actor.id, assignmentId(actor), companyId, input.amount,
          input.reference ?? "", input.note ?? "", input.commandId],
      );
      const parsed = topUpRequestResultSchema.safeParse(result.rows[0]?.payload);
      if (!parsed.success) throw new CompanyWalletUnavailableError();
      return parsed.data;
    });
  } catch (error) {
    if (error instanceof CompanyWalletValidationError
      || error instanceof CompanyWalletUnavailableError) throw error;
    throw new CompanyWalletUnavailableError();
  }
}

export async function recordCompanyWalletTopUp(
  actor: AuthenticatedSessionUser,
  value: RecordCompanyWalletTopUpInput,
): Promise<TopUpRecordResult> {
  const input = validated(recordTopUpInputSchema, value);
  if (isDemoMode()) {
    if (!actor.isOwner || !canAccess(actor, "record_wallet_top_up")
      || !getDemoStore().companies.some((company) => company.id === input.companyId)) {
      throw new CompanyWalletUnavailableError();
    }
    const state = demoFinanceState();
    const fingerprint = demoCommandFingerprint([
      actor.id,
      input.companyId,
      input.topUpRequestId ?? null,
      input.amount,
      input.effectiveDate,
      input.reference,
      input.reason,
    ]);
    const prior = replayDemoCommand(
      state.recordCommands.get(input.commandId),
      fingerprint,
    );
    if (prior) return prior;
    const topUpRequest = input.topUpRequestId
      ? state.requests.get(input.topUpRequestId)
      : undefined;
    if (input.topUpRequestId && (!topUpRequest
      || topUpRequest.companyId !== input.companyId)) {
      throw new CompanyWalletUnavailableError();
    }
    const existingLedgerId = input.topUpRequestId
      ? state.topUpLedgerByRequest.get(input.topUpRequestId)
      : undefined;
    if (existingLedgerId) {
      const existingLedger = state.ledger.get(existingLedgerId)?.entry;
      if (!existingLedger) throw new CompanyWalletUnavailableError();
      const result = freezeDemoResult<TopUpRecordResult>({
        created: false,
        status: "RECEIVED",
        topUpRequestId: input.topUpRequestId,
        ledgerEntryId: existingLedger.id,
        amount: parsePositiveMoneyDecimal(existingLedger.amountDelta),
        currency: existingLedger.currency,
      });
      state.recordCommands.set(input.commandId, { fingerprint, result });
      return result;
    }
    const current = state.balances.get(input.companyId) ?? parseMoneyDecimal("0.00");
    state.balances.set(input.companyId, moneyDecimalFromMinorUnits(
      moneyDecimalToMinorUnits(current) + moneyDecimalToMinorUnits(input.amount),
    ));
    const postedAt = new Date();
    const result = freezeDemoResult<TopUpRecordResult>({
      created: true,
      status: "RECEIVED",
      ...(input.topUpRequestId ? { topUpRequestId: input.topUpRequestId } : {}),
      ledgerEntryId: input.commandId,
      amount: input.amount,
      currency: "MYR",
    });
    const ledgerEntry = freezeDemoResult<CompanyWalletLedgerEntry>({
      id: result.ledgerEntryId,
      type: "TOP_UP",
      amountDelta: input.amount,
      currency: "MYR",
      effectiveDate: input.effectiveDate,
      reference: input.reference,
      reason: input.reason,
      requestId: null,
      invoiceId: null,
      postedAt,
      actorUserId: actor.id,
    });
    state.ledger.set(result.ledgerEntryId, {
      companyId: input.companyId,
      entry: ledgerEntry,
    });
    if (input.topUpRequestId && topUpRequest) {
      state.topUpLedgerByRequest.set(input.topUpRequestId, result.ledgerEntryId);
      state.requests.set(input.topUpRequestId, {
        companyId: topUpRequest.companyId,
        request: freezeDemoResult<CompanyWalletTopUpRequest>({
          ...topUpRequest.request,
          status: "RECEIVED",
          processedAt: postedAt,
        }),
      });
    }
    state.recordCommands.set(input.commandId, { fingerprint, result });
    return result;
  }
  const companyId = productionUuid(input.companyId);
  const topUpRequestId = input.topUpRequestId
    ? productionUuid(input.topUpRequestId)
    : null;
  try {
    return await withAuditTransaction({
      actor,
      reason: input.reason,
      reasonCode: "wallet.top_up.record",
      commandId: input.commandId,
    }, async (client) => {
      const result = await client.query<PayloadRow>(
        `SELECT public.axora_record_company_wallet_top_up(
           $1,$2,$3,$4,$5,$6,$7,$8,$9,now()
         ) AS payload`,
        [actor.id, assignmentId(actor), companyId, topUpRequestId,
          input.amount, input.effectiveDate, input.reference, input.reason,
          input.commandId],
      );
      const parsed = topUpRecordResultSchema.safeParse(result.rows[0]?.payload);
      if (!parsed.success) throw new CompanyWalletUnavailableError();
      return parsed.data;
    });
  } catch (error) {
    if (error instanceof CompanyWalletValidationError
      || error instanceof CompanyWalletUnavailableError) throw error;
    throw new CompanyWalletUnavailableError();
  }
}

export async function approveAndPay(
  actor: AuthenticatedSessionUser,
  value: ApproveAndPayInput,
): Promise<ApproveAndPayResult> {
  const input = validated(approveAndPayInputSchema, value);
  if (isDemoMode()) {
    const state = demoFinanceState();
    const fingerprint = demoCommandFingerprint([
      actor.id,
      input.requestId,
      input.expectedApprovalRevision,
      input.reason,
    ]);
    const prior = replayDemoCommand(
      state.approveCommands.get(input.commandId),
      fingerprint,
    );
    if (prior) return prior;
    const request = getDemoStore().requests.find((item) => item.id === input.requestId);
    if (!request || request.createdById === actor.id
      || !demoCompanyAllowed(actor, request.companyId)
      || !canAccess(actor, "approve_requests")) {
      throw new CompanyWalletUnavailableError();
    }
    const requestAmount = parsePositiveMoneyDecimal(String(request.estimatedTotal));
    const balance = state.balances.get(request.companyId) ?? parseMoneyDecimal("0.00");
    let result: ApproveAndPayResult;
    if (request.paymentStatus === "Paid") {
      const invoiceId = state.invoiceIdsByRequest.get(request.id) ?? input.commandId;
      result = {
        status: "ALREADY_PROCESSED",
        commandId: input.commandId,
        requestId: request.id,
        invoiceId,
        amount: requestAmount,
        currency: "MYR",
        created: false,
        correlationId: `demo-correlation-${request.id}`,
      };
    } else if (moneyDecimalToMinorUnits(balance) < moneyDecimalToMinorUnits(requestAmount)) {
      result = {
        status: "INSUFFICIENT_WALLET",
        commandId: input.commandId,
        requestId: request.id,
        requiredAmount: requestAmount,
        availableAmount: balance,
        currency: "MYR",
      };
    } else if (request.approvalStatus === "Rejected") {
      result = {
        status: "NOT_READY",
        commandId: input.commandId,
        requestId: request.id,
        requestState: "REJECTED",
      };
    } else {
      state.balances.set(request.companyId, moneyDecimalFromMinorUnits(
        moneyDecimalToMinorUnits(balance) - moneyDecimalToMinorUnits(requestAmount),
      ));
      request.approvalStatus = "Approved";
      request.approvalReason = input.reason;
      request.paymentStatus = "Paid";
      request.invoiceStatus = "Issued";
      request.invoiceNumber = `CINV-DEMO-${request.id}`;
      const invoiceId = input.commandId;
      state.invoiceIdsByRequest.set(request.id, invoiceId);
      const postedAt = new Date();
      const paymentDelta = moneyDecimalFromMinorUnits(
        -moneyDecimalToMinorUnits(requestAmount),
      );
      state.ledger.set(input.commandId, {
        companyId: request.companyId,
        entry: freezeDemoResult<CompanyWalletLedgerEntry>({
          id: input.commandId,
          type: "PAYMENT",
          amountDelta: paymentDelta,
          currency: "MYR",
          effectiveDate: postedAt.toISOString().slice(0, 10),
          reference: request.invoiceNumber,
          reason: input.reason,
          requestId: request.id,
          invoiceId,
          postedAt,
          actorUserId: actor.id,
        }),
      });
      result = {
        status: "SUCCESS",
        commandId: input.commandId,
        requestId: request.id,
        invoiceId,
        amount: requestAmount,
        currency: "MYR",
        created: true,
        correlationId: `demo-correlation-${input.commandId}`,
      };
    }
    const frozenResult = freezeDemoResult(result);
    state.approveCommands.set(input.commandId, { fingerprint, result: frozenResult });
    return frozenResult;
  }
  const requestId = productionUuid(input.requestId);
  try {
    return await withAuditTransaction({
      actor,
      reason: input.reason,
      reasonCode: "request.approve_and_pay",
      commandId: input.commandId,
    }, async (client) => {
      const result = await client.query<PayloadRow>(
        `SELECT public.axora_approve_and_pay(
           $1,$2,$3,$4,$5,$6,now()
         ) AS payload`,
        [actor.id, assignmentId(actor), requestId,
          input.expectedApprovalRevision, input.reason, input.commandId],
      );
      return parseApproveAndPayResult(result.rows[0]?.payload);
    });
  } catch (error) {
    if (error instanceof CompanyWalletValidationError
      || error instanceof CompanyWalletUnavailableError) throw error;
    throw new CompanyWalletUnavailableError();
  }
}

export const companyWalletInternals = {
  approveAndPayInputSchema,
  approveAndPayResultSchema,
  ledgerEntrySchema,
  recordTopUpInputSchema,
  requestTopUpInputSchema,
  walletWorkspaceSchema,
};
