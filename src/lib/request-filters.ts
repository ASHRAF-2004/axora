import { REQUEST_STATUSES } from "./domain";

export const REQUEST_FILTER_DIMENSIONS = [
  "company",
  "category",
  "manager",
  "branch",
  "department",
  "costCentre",
  "requester",
  "approver",
  "deliveryAgent",
  "supplier",
  "budgetException",
] as const;

export type RequestFilterDimension = typeof REQUEST_FILTER_DIMENSIONS[number];

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
  supplierIds: string[];
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_DIMENSIONS = new Set<RequestFilterDimension>([
  "company",
  "manager",
  "branch",
  "department",
  "costCentre",
  "requester",
  "approver",
  "deliveryAgent",
  "supplier",
]);

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

function uuidValues(raw: RawRequestSearchParams, key: string) {
  return unique(valuesFor(raw, key).filter((value) => UUID.test(value)));
}

function textValues(raw: RawRequestSearchParams, key: string, maximumLength = 160) {
  return unique(valuesFor(raw, key)
    .map((value) => value.normalize("NFKC").slice(0, maximumLength)));
}

function dateValue(raw: RawRequestSearchParams, key: string) {
  const value = valuesFor(raw, key)[0];
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value
    ? undefined
    : value;
}

function numberValue(raw: RawRequestSearchParams, key: string) {
  const value = Number(valuesFor(raw, key)[0]);
  return Number.isFinite(value) && value >= 0 && value <= 1_000_000_000_000
    ? value
    : undefined;
}

function positiveInteger(raw: RawRequestSearchParams, key: string, fallback: number) {
  const value = Number(valuesFor(raw, key)[0]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function normalizeRequestFilters(raw: RawRequestSearchParams): RequestFilters {
  const statuses = textValues(raw, "status", 80).filter((value) => (
    value === "open" || REQUEST_STATUSES.includes(value as typeof REQUEST_STATUSES[number])
  ));
  const budgetExceptionStatuses = textValues(raw, "budgetException", 40)
    .filter((value): value is RequestBudgetExceptionStatus => (
      REQUEST_BUDGET_EXCEPTION_STATUSES.includes(value as RequestBudgetExceptionStatus)
    ));
  const requestedSort = valuesFor(raw, "sort")[0] as RequestSort | undefined;
  const requestedPageSize = positiveInteger(raw, "pageSize", 25);

  return {
    query: (valuesFor(raw, "q")[0] ?? "").normalize("NFKC").slice(0, 150),
    companyIds: uuidValues(raw, "company"),
    categories: textValues(raw, "category"),
    statuses,
    managerIds: uuidValues(raw, "manager"),
    branchIds: uuidValues(raw, "branch"),
    departmentIds: uuidValues(raw, "department"),
    costCentreIds: uuidValues(raw, "costCentre"),
    requesterIds: uuidValues(raw, "requester"),
    approverIds: uuidValues(raw, "approver"),
    deliveryAgentIds: uuidValues(raw, "deliveryAgent"),
    supplierIds: uuidValues(raw, "supplier"),
    budgetExceptionStatuses,
    neededFrom: dateValue(raw, "neededFrom"),
    neededTo: dateValue(raw, "neededTo"),
    submittedFrom: dateValue(raw, "submittedFrom"),
    submittedTo: dateValue(raw, "submittedTo"),
    approvedFrom: dateValue(raw, "approvedFrom"),
    approvedTo: dateValue(raw, "approvedTo"),
    completedFrom: dateValue(raw, "completedFrom"),
    completedTo: dateValue(raw, "completedTo"),
    minAmount: numberValue(raw, "minAmount"),
    maxAmount: numberValue(raw, "maxAmount"),
    sort: REQUEST_SORTS.includes(requestedSort as RequestSort)
      ? requestedSort!
      : "submitted-desc",
    page: Math.min(positiveInteger(raw, "page", 1), 100_000),
    pageSize: [25, 50, 100].includes(requestedPageSize) ? requestedPageSize : 25,
  };
}

export function requestFiltersToSearchParams(
  filters: RequestFilters,
  options: { omitPagination?: boolean } = {},
) {
  const params = new URLSearchParams();
  if (filters.query) params.set("q", filters.query);
  const lists: Array<[string, readonly string[]]> = [
    ["company", filters.companyIds],
    ["category", filters.categories],
    ["status", filters.statuses],
    ["manager", filters.managerIds],
    ["branch", filters.branchIds],
    ["department", filters.departmentIds],
    ["costCentre", filters.costCentreIds],
    ["requester", filters.requesterIds],
    ["approver", filters.approverIds],
    ["deliveryAgent", filters.deliveryAgentIds],
    ["supplier", filters.supplierIds],
    ["budgetException", filters.budgetExceptionStatuses],
  ];
  for (const [key, values] of lists) {
    for (const value of values) params.append(key, value);
  }
  const singles: Array<[string, string | number | undefined]> = [
    ["neededFrom", filters.neededFrom], ["neededTo", filters.neededTo],
    ["submittedFrom", filters.submittedFrom], ["submittedTo", filters.submittedTo],
    ["approvedFrom", filters.approvedFrom], ["approvedTo", filters.approvedTo],
    ["completedFrom", filters.completedFrom], ["completedTo", filters.completedTo],
    ["minAmount", filters.minAmount], ["maxAmount", filters.maxAmount],
  ];
  for (const [key, value] of singles) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  if (filters.sort !== "submitted-desc") params.set("sort", filters.sort);
  if (filters.pageSize !== 25) params.set("pageSize", String(filters.pageSize));
  if (!options.omitPagination && filters.page > 1) params.set("page", String(filters.page));
  return params;
}

export function hasActiveRequestFilters(filters: RequestFilters) {
  return Boolean(
    filters.query
    || filters.companyIds.length
    || filters.categories.length
    || filters.statuses.length
    || filters.managerIds.length
    || filters.branchIds.length
    || filters.departmentIds.length
    || filters.costCentreIds.length
    || filters.requesterIds.length
    || filters.approverIds.length
    || filters.deliveryAgentIds.length
    || filters.supplierIds.length
    || filters.budgetExceptionStatuses.length
    || filters.neededFrom || filters.neededTo
    || filters.submittedFrom || filters.submittedTo
    || filters.approvedFrom || filters.approvedTo
    || filters.completedFrom || filters.completedTo
    || filters.minAmount !== undefined || filters.maxAmount !== undefined
    || filters.sort !== "submitted-desc",
  );
}

export function isRequestFilterDimension(value: string): value is RequestFilterDimension {
  return REQUEST_FILTER_DIMENSIONS.includes(value as RequestFilterDimension);
}

export function normalizeRequestOptionValues(
  dimension: RequestFilterDimension,
  values: string[],
) {
  return unique(values.map((value) => value.trim()).filter(Boolean))
    .filter((value) => UUID_DIMENSIONS.has(dimension)
      ? UUID.test(value)
      : value.length <= 160);
}

export const requestFilterInternals = { valuesFor, dateValue, numberValue };
