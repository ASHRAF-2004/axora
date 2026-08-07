import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import {
  authorize,
  isPermissionCode,
  type AuthorizationScope,
  type PermissionCode,
} from "./authorization-policy";
import { isDemoMode, query } from "./db";
import { getDemoStore } from "./demo-data";
import { loadEffectiveAccess } from "./effective-access";
import type { Branch, Company } from "./types";

const uuidSchema = z.string().uuid();
const permissionSchema = z.string()
  .refine(isPermissionCode, "Unknown permission")
  .transform((value) => value as PermissionCode);
const resourceTypeSchema = z.enum(["COMPANY", "BRANCH", "DEPARTMENT"]);
const statusSchema = z.enum(["Active", "Inactive"]);

const companySchema = z.object({
  id: uuidSchema,
  code: z.string().trim().min(1).max(80),
  name: z.string().trim().min(1).max(300),
  industry: z.string().max(300),
  companyInformation: z.string().max(5000).optional(),
  websiteUrl: z.string().max(2048).optional(),
  mainContactName: z.string().max(300),
  mainContactEmail: z.string().max(320),
  mainContactPhone: z.string().max(120),
  billingContactName: z.string().max(300),
  billingContactEmail: z.string().max(320),
  billingContactPhone: z.string().max(120),
  billingAddress: z.string().max(5000),
  paymentTerms: z.string().max(300),
  billingCycle: z.string().max(300),
  taxRate: z.coerce.number().finite(),
  estimatedDeliveryFee: z.coerce.number().finite(),
  notes: z.string().max(5000).optional(),
  status: statusSchema,
}).strict();

const branchSchema = z.object({
  id: uuidSchema,
  code: z.string().trim().min(1).max(80),
  companyId: uuidSchema,
  companyName: z.string().trim().min(1).max(300),
  name: z.string().trim().min(1).max(300),
  branchCode: z.string().trim().min(1).max(80),
  deliveryAddress: z.string().max(5000),
  city: z.string().max(300),
  contactName: z.string().max(300),
  contactPhone: z.string().max(120),
  contactEmail: z.string().max(320),
  deliveryInstructions: z.string().max(5000).optional(),
  notes: z.string().max(5000).optional(),
  canViewBudget: z.boolean(),
  monthlyBudget: z.coerce.number().finite().nonnegative().nullable().optional(),
  committedAmount: z.coerce.number().finite().nonnegative().optional(),
  remainingAmount: z.coerce.number().finite().nullable().optional(),
  status: statusSchema,
}).strict().superRefine((branch, context) => {
  if (!branch.canViewBudget && (
    branch.monthlyBudget !== undefined
    || branch.committedAmount !== undefined
    || branch.remainingAmount !== undefined
  )) {
    context.addIssue({
      code: "custom",
      path: ["canViewBudget"],
      message: "Hidden branch budget data must not be returned",
    });
  }
  if (branch.canViewBudget && branch.committedAmount === undefined) {
    context.addIssue({
      code: "custom",
      path: ["committedAmount"],
      message: "Visible branch budget data is incomplete",
    });
  }
});

const directorySchema = z.object({
  capturedAt: z.coerce.date(),
  companies: z.array(companySchema),
  branches: z.array(branchSchema),
}).strict();

const scopeSchema = z.object({
  type: z.enum(["COMPANY", "BRANCH", "DEPARTMENT"]),
  companyId: uuidSchema,
  branchId: uuidSchema.optional(),
  departmentId: uuidSchema.optional(),
  supplierId: uuidSchema.optional(),
}).strict();

const resourceAccessSchema = z.object({
  capturedAt: z.coerce.date(),
  permission: permissionSchema,
  resourceType: resourceTypeSchema,
  resourceId: uuidSchema,
  active: z.boolean(),
  scope: scopeSchema,
}).strict();

interface SnapshotRow extends QueryResultRow {
  snapshot: unknown;
}

export type OrganizationCompany = Omit<Company, "paymentTerms"> & {
  paymentTerms: string;
};

export type OrganizationBranch = Omit<
  Branch,
  "committedAmount" | "monthlyBudget" | "remainingAmount"
> & {
  canViewBudget: boolean;
  monthlyBudget?: number | null;
  committedAmount?: number;
  remainingAmount?: number | null;
};

export interface OrganizationDirectory {
  capturedAt: Date;
  companies: OrganizationCompany[];
  branches: OrganizationBranch[];
}

export interface OrganizationResourceAccess {
  capturedAt: Date;
  permission: PermissionCode;
  resourceType: z.infer<typeof resourceTypeSchema>;
  resourceId: string;
  active: boolean;
  scope: AuthorizationScope;
}

export class OrganizationAccessUnavailableError extends Error {
  constructor() {
    super("The requested organization resource is unavailable.");
    this.name = "OrganizationAccessUnavailableError";
  }
}

function uniqueIds(values: readonly { id: string }[]) {
  return new Set(values.map((value) => value.id)).size === values.length;
}

function permissionAtAnyScope(
  subject: Awaited<ReturnType<typeof loadEffectiveAccess>>["subject"],
  permission: PermissionCode,
  scopes: readonly AuthorizationScope[],
  capturedAt: Date,
) {
  return scopes.some((scope) => authorize({
    subject,
    permission,
    resource: { scope },
    now: capturedAt,
  }).allowed);
}

async function demoDirectory(
  actor: AuthenticatedSessionUser,
  capturedAt: Date,
): Promise<OrganizationDirectory> {
  const effective = await loadEffectiveAccess(actor, capturedAt);
  const store = getDemoStore();
  const companies = store.companies.filter((company) => {
    const contexts = effective.subject.scopes.filter((scope) => (
      scope.companyId === company.id
    ));
    return permissionAtAnyScope(
      effective.subject,
      "company.view",
      contexts,
      capturedAt,
    ) || permissionAtAnyScope(
      effective.subject,
      "company.view.assigned",
      contexts,
      capturedAt,
    );
  }).map((company) => ({ ...company, paymentTerms: String(company.paymentTerms) }));

  const branches = store.branches.flatMap((branch) => {
    const contexts = effective.subject.scopes.filter((scope) => (
      scope.companyId === branch.companyId
      && (
        scope.type === "COMPANY"
        || (scope.type === "BRANCH" && scope.branchId === branch.id)
        || (scope.type === "DEPARTMENT" && scope.branchId === branch.id)
      )
    ));
    if (!permissionAtAnyScope(
      effective.subject,
      "organization.branch.view",
      contexts,
      capturedAt,
    )) return [];

    const branchScope: AuthorizationScope = {
      type: "BRANCH",
      companyId: branch.companyId,
      branchId: branch.id,
    };
    const canViewBudget = authorize({
      subject: effective.subject,
      permission: "budget.view",
      resource: { scope: branchScope },
      now: capturedAt,
    }).allowed;
    return [{
      ...branch,
      canViewBudget,
      ...(canViewBudget ? {
        monthlyBudget: branch.monthlyBudget,
        committedAmount: branch.committedAmount,
        remainingAmount: branch.remainingAmount,
      } : {
        monthlyBudget: undefined,
        committedAmount: undefined,
        remainingAmount: undefined,
      }),
    }];
  });

  return { capturedAt, companies, branches };
}

function validateDirectory(
  raw: unknown,
  expectedCapturedAt: Date,
): OrganizationDirectory {
  const parsed = directorySchema.safeParse(raw);
  if (!parsed.success
    || parsed.data.capturedAt.getTime() !== expectedCapturedAt.getTime()
    || !uniqueIds(parsed.data.companies)
    || !uniqueIds(parsed.data.branches)) {
    throw new OrganizationAccessUnavailableError();
  }
  return parsed.data as OrganizationDirectory;
}

export async function loadOrganizationDirectory(
  actor: AuthenticatedSessionUser,
  capturedAt = new Date(),
): Promise<OrganizationDirectory> {
  if (!Number.isFinite(capturedAt.getTime())) {
    throw new OrganizationAccessUnavailableError();
  }
  if (isDemoMode()) return demoDirectory(actor, capturedAt);
  if (!actor.roleAssignmentId) {
    throw new OrganizationAccessUnavailableError();
  }

  try {
    const result = await query<SnapshotRow>(
      `SELECT public.axora_organization_directory_snapshot(
         $1,$2,$3
       ) AS snapshot`,
      [actor.id, actor.roleAssignmentId, capturedAt],
    );
    if (result.rowCount !== 1 || !result.rows[0]?.snapshot) {
      throw new OrganizationAccessUnavailableError();
    }
    return validateDirectory(result.rows[0].snapshot, capturedAt);
  } catch (error) {
    if (error instanceof OrganizationAccessUnavailableError) throw error;
    throw new OrganizationAccessUnavailableError();
  }
}

export async function loadOrganizationResourceAccess(
  actor: AuthenticatedSessionUser,
  input: {
    permission: PermissionCode;
    resourceType: z.infer<typeof resourceTypeSchema>;
    resourceId: string;
    capturedAt?: Date;
  },
): Promise<OrganizationResourceAccess> {
  const capturedAt = input.capturedAt ?? new Date();
  const request = z.object({
    permission: permissionSchema,
    resourceType: resourceTypeSchema,
    resourceId: uuidSchema,
  }).strict().safeParse({
    permission: input.permission,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
  });
  if (!request.success
    || !Number.isFinite(capturedAt.getTime())
    || !actor.roleAssignmentId
    || isDemoMode()) {
    throw new OrganizationAccessUnavailableError();
  }

  try {
    const result = await query<SnapshotRow>(
      `SELECT public.axora_organization_resource_access(
         $1,$2,$3,$4,$5,$6
       ) AS snapshot`,
      [
        actor.id,
        actor.roleAssignmentId,
        request.data.permission,
        request.data.resourceType,
        request.data.resourceId,
        capturedAt,
      ],
    );
    const parsed = resourceAccessSchema.safeParse(result.rows[0]?.snapshot);
    if (!parsed.success
      || parsed.data.capturedAt.getTime() !== capturedAt.getTime()
      || parsed.data.permission !== request.data.permission
      || parsed.data.resourceType !== request.data.resourceType
      || parsed.data.resourceId !== request.data.resourceId) {
      throw new OrganizationAccessUnavailableError();
    }
    return parsed.data as OrganizationResourceAccess;
  } catch (error) {
    if (error instanceof OrganizationAccessUnavailableError) throw error;
    throw new OrganizationAccessUnavailableError();
  }
}

export const organizationAccessInternals = {
  branchSchema,
  companySchema,
  directorySchema,
  resourceAccessSchema,
  uniqueIds,
  validateDirectory,
};
