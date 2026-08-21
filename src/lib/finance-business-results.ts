import type { MoneyDecimalString } from "./money-decimal";

export const APPROVE_AND_PAY_RESULT_STATUSES = [
  "SUCCESS",
  "ALREADY_PROCESSED",
  "INSUFFICIENT_WALLET",
  "INSUFFICIENT_BUDGET",
  "STALE_REQUEST",
  "NOT_READY",
] as const;

export const APPROVE_AND_PAY_LOCAL_NOT_READY_STATES = [
  "BRANCH_LOCATION_REQUIRED",
] as const;

export type ApproveAndPayLocalNotReadyState =
  (typeof APPROVE_AND_PAY_LOCAL_NOT_READY_STATES)[number];

export type ApproveAndPayResultStatus =
  (typeof APPROVE_AND_PAY_RESULT_STATUSES)[number];

interface ApproveAndPayResultBase<Status extends ApproveAndPayResultStatus> {
  readonly status: Status;
  readonly commandId: string;
  readonly requestId: string;
  readonly correlationId?: string;
}

interface SettledApproveAndPayResult<
  Status extends "SUCCESS" | "ALREADY_PROCESSED",
> extends ApproveAndPayResultBase<Status> {
  readonly invoiceId: string;
  readonly amount: MoneyDecimalString;
  readonly currency: string;
  readonly created: Status extends "SUCCESS" ? true : false;
}

interface InsufficientFundsResult<
  Status extends "INSUFFICIENT_WALLET" | "INSUFFICIENT_BUDGET",
> extends ApproveAndPayResultBase<Status> {
  readonly requiredAmount: MoneyDecimalString;
  readonly availableAmount: MoneyDecimalString;
  readonly currency: string;
}

export type ApproveAndPayResult =
  | SettledApproveAndPayResult<"SUCCESS">
  | SettledApproveAndPayResult<"ALREADY_PROCESSED">
  | InsufficientFundsResult<"INSUFFICIENT_WALLET">
  | InsufficientFundsResult<"INSUFFICIENT_BUDGET">
  | (ApproveAndPayResultBase<"STALE_REQUEST"> & {
      readonly expectedRevision: number;
      readonly currentRevision: number;
    })
  | (ApproveAndPayResultBase<"NOT_READY"> & {
      readonly requestState: string;
    });

export const TOP_UP_STATUSES = [
  "REQUESTED",
  "ACKNOWLEDGED",
  "RECEIVED",
  "REJECTED",
  "CANCELLED",
] as const;

export type TopUpStatus = (typeof TOP_UP_STATUSES)[number];

export interface TopUpRequestResult {
  readonly created: boolean;
  readonly requestId: string;
  readonly status: TopUpStatus;
  readonly amount: MoneyDecimalString;
  readonly currency: string;
  readonly workflowEventId?: string;
}

export interface TopUpRecordResult {
  readonly created: boolean;
  readonly status: "RECEIVED";
  readonly topUpRequestId?: string;
  readonly ledgerEntryId: string;
  readonly amount: MoneyDecimalString;
  readonly currency: string;
  readonly workflowEventId?: string;
}

export function isApproveAndPayResultStatus(
  value: unknown,
): value is ApproveAndPayResultStatus {
  return typeof value === "string"
    && (APPROVE_AND_PAY_RESULT_STATUSES as readonly string[]).includes(value);
}

export function isApproveAndPayLocalNotReadyState(
  value: unknown,
): value is ApproveAndPayLocalNotReadyState {
  return typeof value === "string"
    && (APPROVE_AND_PAY_LOCAL_NOT_READY_STATES as readonly string[]).includes(value);
}

export function isTopUpStatus(value: unknown): value is TopUpStatus {
  return typeof value === "string"
    && (TOP_UP_STATUSES as readonly string[]).includes(value);
}
