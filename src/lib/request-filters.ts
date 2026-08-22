import { REQUEST_STATUSES } from "./domain";

export const REQUEST_BUDGET_EXCEPTION_STATUSES = [
  "NONE",
  "ACTIVE",
  "BUDGET_AVAILABLE",
  "COMPANY_CEILING",
  "APPROVAL_LIMIT",
  "ADDITIONAL_ACTUAL",
  "RESOLVED",
] as const;

export type RequestBudgetExceptionStatus =
  typeof REQUEST_BUDGET_EXCEPTION_STATUSES[number];

export const REQUEST_SORTS = [
  "submitted-desc",
  "submitted-asc",
  "needed-asc",
  "needed-desc",
  "amount-desc",
  "amount-asc",
] as const;

export type RequestSort = typeof REQUEST_SORTS[number];

export interface RequestFilters {
  query: string;
  companyIds: string[];
  categories: string[];
  statuses: string[];
  managerIds: string[];
  branchIds: string[];
  departmentIds: string[];
  costCentreIds: string[];
  requesterIds: string[];
  approverIds: string[];
  deliveryAgentIds: string[];
  budgetExceptionStatuses: RequestBudgetExceptionStatus[];
  neededFrom?: string;
  neededTo?: string;
  submittedFrom?: string;
  submittedTo?: string;
  approvedFrom?: string;
  approvedTo?: string;
  completedFrom?: string;
  completedTo?: string;
  minAmount?: number;
  maxAmount?: number;
  sort: RequestSort;
  page: number;
  pageSize: number;
}

export type RawRequestSearchParams = URLSearchParams | Record<
  string,
  string | string[] | undefined
>;

function valuesFor(raw: RawRequestSearchParams, key: string) {
  const values = raw instanceof URLSearchParams
    ? raw.getAll(key)
    : Array.isArray(raw[key])
      ? raw[key]
      : raw[key] === undefined
        ? []
        : [raw[key]];

  return values
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean);
}

function unique(values: string[], maximum = 20) {
  return [...new Set(values)].slice(0, maximum);
}

function textValues(raw: RawRequestSearchParams, key: string, maximumLength = 160) {
  return unique(valuesFor(raw, key)
    .map((value) => value.normalize("NFKC").slice(0, maximumLength)));
}

function positiveInteger(raw: RawRequestSearchParams, key: string, fallback: number) {
  const value = Number(valuesFor(raw, key)[0]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function normalizeRequestFilters(raw: RawRequestSearchParams): RequestFilters {
  const statuses = textValues(raw, "status", 80).filter((value) => (
    value === "open" || REQUEST_STATUSES.includes(value as typeof REQUEST_STATUSES[number])
  ));
  return {
    query: (valuesFor(raw, "q")[0] ?? "").normalize("NFKC").slice(0, 150),
    companyIds: [],
    categories: [],
    statuses,
    managerIds: [],
    branchIds: [],
    departmentIds: [],
    costCentreIds: [],
    requesterIds: [],
    approverIds: [],
    deliveryAgentIds: [],
    budgetExceptionStatuses: [],
    sort: "submitted-desc",
    page: Math.min(positiveInteger(raw, "page", 1), 100_000),
    pageSize: 25,
  };
}

export function requestFiltersToSearchParams(
  filters: RequestFilters,
  options: { omitPagination?: boolean } = {},
) {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  for (const value of filters.statuses.slice(0, 1)) params.append("status", value);
  if (!options.omitPagination && filters.page > 1) params.set("page", String(filters.page));
  return params;
}

export function hasActiveRequestFilters(filters: RequestFilters) {
  return Boolean(filters.query || filters.statuses.length);
}
