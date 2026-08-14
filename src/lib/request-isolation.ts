import type { PoolClient } from "pg";
import { z } from "zod";
import type { AuthenticatedSessionUser } from "./auth";
import {
  authorize,
  isPermissionCode,
  type AuthorizationScope,
  type PermissionCode,
} from "./authorization-policy";
import { loadEffectiveAccess } from "./effective-access";
import type { ProcurementRequest } from "./types";

const uuidSchema = z.string().uuid();
const permissionSchema = z.string()
  .refine(isPermissionCode, "Unknown permission")
  .transform((value) => value as PermissionCode);

const branchScopeSchema = z.object({
  type: z.literal("BRANCH"),
  companyId: uuidSchema,
  branchId: uuidSchema,
}).strict();

const departmentScopeSchema = z.object({
  type: z.literal("DEPARTMENT"),
  companyId: uuidSchema,
  branchId: uuidSchema,
  departmentId: uuidSchema,
}).strict();

const requestScopeSchema = z.discriminatedUnion("type", [
  branchScopeSchema,
  departmentScopeSchema,
]);

const optionalUuid = z.preprocess(
  (value) => value === null || value === "" ? undefined : value,
  uuidSchema.optional(),
);

const requestResourceContextSchema = z.object({
  capturedAt: z.coerce.date(),
  permission: permissionSchema,
  requestId: uuidSchema,
  ownerUserId: optionalUuid,
  companyId: uuidSchema,
  branchId: uuidSchema,
  departmentId: optionalUuid,
  active: z.boolean(),
  scope: requestScopeSchema,
}).strict().superRefine((context, refinement) => {
  if (context.scope.companyId !== context.companyId
    || context.scope.branchId !== context.branchId) {
    refinement.addIssue({
      code: "custom",
      path: ["scope"],
      message: "Request scope ownership is inconsistent",
    });
  }
  if (context.scope.type === "DEPARTMENT") {
    if (context.departmentId !== context.scope.departmentId) {
      refinement.addIssue({
        code: "custom",
        path: ["departmentId"],
        message: "Request department ownership is inconsistent",
      });
    }
  } else if (context.departmentId !== undefined) {
    refinement.addIssue({
      code: "custom",
      path: ["departmentId"],
      message: "Branch request unexpectedly carries a department",
    });
  }
});

const requestCreationContextSchema = z.object({
  capturedAt: z.coerce.date(),
  companyId: uuidSchema,
  companyName: z.string().trim().min(1).max(300),
  branchId: uuidSchema,
  branchName: z.string().trim().min(1).max(300),
  departmentId: optionalUuid,
  departmentName: z.preprocess(
    (value) => value === null || value === "" ? undefined : value,
    z.string().trim().min(1).max(300).optional(),
  ),
  taxRate: z.coerce.number().finite().min(0).max(100),
  estimatedDeliveryFee: z.coerce.number().finite().nonnegative(),
  scope: requestScopeSchema,
}).strict().superRefine((context, refinement) => {
  if (context.scope.companyId !== context.companyId
    || context.scope.branchId !== context.branchId) {
    refinement.addIssue({
      code: "custom",
      path: ["scope"],
      message: "Request creation scope is inconsistent",
    });
  }
  if (context.scope.type === "DEPARTMENT") {
    if (context.departmentId !== context.scope.departmentId
      || context.departmentName === undefined) {
      refinement.addIssue({
        code: "custom",
        path: ["departmentId"],
        message: "Request creation department is incomplete",
      });
    }
  } else if (context.departmentId !== undefined
    || context.departmentName !== undefined) {
    refinement.addIssue({
      code: "custom",
      path: ["departmentId"],
      message: "Branch request creation carries department data",
    });
  }
});

interface SnapshotRow {
  snapshot: unknown;
}

export type RequestResourceContext = z.infer<
  typeof requestResourceContextSchema
>;
export type RequestCreationContext = z.infer<
  typeof requestCreationContextSchema
>;

export class RequestAccessUnavailableError extends Error {
  constructor() {
    super("The requested purchase request is unavailable.");
    this.name = "RequestAccessUnavailableError";
  }
}

function requireLiveAssignment(actor: AuthenticatedSessionUser) {
  if (!actor.roleAssignmentId) throw new RequestAccessUnavailableError();
  return actor.roleAssignmentId;
}

function requestScope(request: Pick<
  ProcurementRequest,
  "companyId" | "branchId" | "departmentId"
>): AuthorizationScope {
  return request.departmentId
    ? {
        type: "DEPARTMENT",
        companyId: request.companyId,
        branchId: request.branchId,
        departmentId: request.departmentId,
      }
    : {
        type: "BRANCH",
        companyId: request.companyId,
        branchId: request.branchId,
      };
}

function permissionAllowed(
  subject: Awaited<ReturnType<typeof loadEffectiveAccess>>["subject"],
  permission: PermissionCode,
  request: Pick<
    ProcurementRequest,
    "companyId" | "branchId" | "departmentId" | "createdById"
  >,
  capturedAt: Date,
) {
  const resource = {
    scope: requestScope(request),
    ownerUserId: request.createdById,
  };
  if (permission === "request.view") {
    const broad = authorize({
      subject,
      permission: "request.view",
      resource,
      now: capturedAt,
    });
    if (broad.allowed) return true;
    return request.createdById === subject.userId && authorize({
      subject,
      permission: "request.view.own",
      resource,
      now: capturedAt,
    }).allowed;
  }
  if (permission === "request.view.own"
    && request.createdById !== subject.userId) {
    return false;
  }
  return authorize({
    subject,
    permission,
    resource,
    now: capturedAt,
  }).allowed;
}

function minimizeDemoRequest(
  subject: Awaited<ReturnType<typeof loadEffectiveAccess>>["subject"],
  request: ProcurementRequest,
  capturedAt: Date,
): ProcurementRequest {
  const canViewFinance = permissionAllowed(
    subject,
    "finance.invoice.view",
    request,
    capturedAt,
  );
  const canViewCommercial = permissionAllowed(
    subject,
    "commercial.cost.view",
    request,
    capturedAt,
  );

  return {
    ...request,
    invoiceStatus: canViewFinance ? request.invoiceStatus : undefined,
    paymentStatus: canViewFinance ? request.paymentStatus : undefined,
    invoiceNumber: canViewFinance ? request.invoiceNumber : undefined,
    lines: request.lines.map((line) => ({
      ...line,
      productId: subject.accountKind === "COMPANY" ? undefined : line.productId,
      productCode: subject.accountKind === "COMPANY" ? undefined : line.productCode,
      supplierId: undefined,
      supplierName: undefined,
      quotationReference: undefined,
      supplierConfirmationStatus: undefined,
      unitBuyPrice: canViewCommercial ? line.unitBuyPrice : 0,
      deliveryCharge: canViewCommercial ? line.deliveryCharge : 0,
    })),
  };
}

export async function filterVisibleDemoRequests(
  actor: AuthenticatedSessionUser,
  requests: readonly ProcurementRequest[],
  capturedAt = new Date(),
): Promise<ProcurementRequest[]> {
  if (!Number.isFinite(capturedAt.getTime())) {
    throw new RequestAccessUnavailableError();
  }
  const effective = await loadEffectiveAccess(actor, capturedAt);
  return requests
    .filter((request) => permissionAllowed(
      effective.subject,
      "request.view",
      request,
      capturedAt,
    ))
    .map((request) => minimizeDemoRequest(
      effective.subject,
      request,
      capturedAt,
    ));
}

export async function findVisibleDemoRequest(
  actor: AuthenticatedSessionUser,
  requests: readonly ProcurementRequest[],
  requestId: string,
  capturedAt = new Date(),
) {
  const visible = await filterVisibleDemoRequests(
    actor,
    requests.filter((request) => request.id === requestId),
    capturedAt,
  );
  return visible[0];
}

export async function requireDemoRequestPermission(
  actor: AuthenticatedSessionUser,
  request: ProcurementRequest,
  permission: PermissionCode,
  capturedAt = new Date(),
) {
  const effective = await loadEffectiveAccess(actor, capturedAt);
  if (!permissionAllowed(
    effective.subject,
    permission,
    request,
    capturedAt,
  )) {
    throw new RequestAccessUnavailableError();
  }
}

export async function requireDemoRequestCreationScope(
  actor: AuthenticatedSessionUser,
  input: {
    companyId: string;
    branchId: string;
    departmentId?: string;
  },
  capturedAt = new Date(),
) {
  const request = {
    companyId: input.companyId,
    branchId: input.branchId,
    departmentId: input.departmentId,
  };
  const effective = await loadEffectiveAccess(actor, capturedAt);
  if (!authorize({
    subject: effective.subject,
    permission: "request.create",
    resource: { scope: requestScope(request) },
    now: capturedAt,
  }).allowed) {
    throw new RequestAccessUnavailableError();
  }
  return requestScope(request);
}

export async function lockRequestResourceAccess(
  client: PoolClient,
  actor: AuthenticatedSessionUser,
  input: {
    permission: PermissionCode;
    requestId: string;
    capturedAt?: Date;
  },
): Promise<RequestResourceContext> {
  const capturedAt = input.capturedAt ?? new Date();
  const assignmentId = requireLiveAssignment(actor);
  if (!uuidSchema.safeParse(input.requestId).success
    || !permissionSchema.safeParse(input.permission).success
    || !Number.isFinite(capturedAt.getTime())) {
    throw new RequestAccessUnavailableError();
  }

  try {
    const result = await client.query<SnapshotRow>(
      `SELECT public.axora_lock_request_resource_access(
         $1,$2,$3,$4,$5
       ) AS snapshot`,
      [
        actor.id,
        assignmentId,
        input.permission,
        input.requestId,
        capturedAt,
      ],
    );
    const parsed = requestResourceContextSchema.safeParse(
      result.rows[0]?.snapshot,
    );
    if (!parsed.success
      || parsed.data.capturedAt.getTime() !== capturedAt.getTime()
      || parsed.data.permission !== input.permission
      || parsed.data.requestId !== input.requestId) {
      throw new RequestAccessUnavailableError();
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof RequestAccessUnavailableError) throw error;
    throw new RequestAccessUnavailableError();
  }
}

export async function lockRequestCreationScope(
  client: PoolClient,
  actor: AuthenticatedSessionUser,
  input: {
    companyId: string;
    branchId: string;
    departmentId?: string;
    capturedAt?: Date;
  },
): Promise<RequestCreationContext> {
  const capturedAt = input.capturedAt ?? new Date();
  const assignmentId = requireLiveAssignment(actor);
  const request = z.object({
    companyId: uuidSchema,
    branchId: uuidSchema,
    departmentId: uuidSchema.optional(),
  }).strict().safeParse({
    companyId: input.companyId,
    branchId: input.branchId,
    departmentId: input.departmentId,
  });
  if (!request.success || !Number.isFinite(capturedAt.getTime())) {
    throw new RequestAccessUnavailableError();
  }

  try {
    const result = await client.query<SnapshotRow>(
      `SELECT public.axora_lock_request_creation_scope(
         $1,$2,$3,$4,$5,$6
       ) AS snapshot`,
      [
        actor.id,
        assignmentId,
        request.data.companyId,
        request.data.branchId,
        request.data.departmentId ?? null,
        capturedAt,
      ],
    );
    const parsed = requestCreationContextSchema.safeParse(
      result.rows[0]?.snapshot,
    );
    if (!parsed.success
      || parsed.data.capturedAt.getTime() !== capturedAt.getTime()
      || parsed.data.companyId !== request.data.companyId
      || parsed.data.branchId !== request.data.branchId
      || parsed.data.departmentId !== request.data.departmentId) {
      throw new RequestAccessUnavailableError();
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof RequestAccessUnavailableError) throw error;
    throw new RequestAccessUnavailableError();
  }
}

export const requestIsolationInternals = {
  minimizeDemoRequest,
  permissionAllowed,
  requestCreationContextSchema,
  requestResourceContextSchema,
  requestScope,
};
