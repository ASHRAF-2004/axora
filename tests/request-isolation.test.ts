import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedSessionUser } from "@/lib/auth";
import type { AuthorizationSubject } from "@/lib/authorization-policy";
import {
  lockRequestCreationScope,
  lockRequestResourceAccess,
  RequestAccessUnavailableError,
  requestIsolationInternals,
} from "@/lib/request-isolation";

const ids = {
  actor: "10000000-0000-4000-8000-000000000045",
  assignment: "20000000-0000-4000-8000-000000000045",
  company: "30000000-0000-4000-8000-000000000045",
  branch: "40000000-0000-4000-8000-000000000045",
  department: "50000000-0000-4000-8000-000000000045",
  request: "60000000-0000-4000-8000-000000000045",
  otherUser: "70000000-0000-4000-8000-000000000045",
} as const;
const capturedAt = new Date("2026-08-07T09:00:00.000Z");

const actor: AuthenticatedSessionUser = {
  id: ids.actor,
  email: "requester@example.test",
  name: "Scoped requester",
  role: "REQUESTER",
  accountKind: "COMPANY",
  scopeType: "DEPARTMENT",
  companyId: ids.company,
  branchId: ids.branch,
  departmentId: ids.department,
  roleAssignmentId: ids.assignment,
  isOwner: false,
  authVersion: 3,
};

function requesterSubject(): AuthorizationSubject {
  return {
    userId: ids.actor,
    role: "REQUESTER",
    accountKind: "COMPANY",
    accountStatus: "ACTIVE",
    isOwner: false,
    scopes: [{
      type: "DEPARTMENT",
      companyId: ids.company,
      branchId: ids.branch,
      departmentId: ids.department,
    }],
    roleGrants: [
      "request.view.own",
      "request.create",
      "request.edit",
      "request.submit",
      "request.cancel",
    ],
    permissionOverrides: [],
    delegations: [],
    approvalLimits: [],
  };
}

function resourceSnapshot() {
  return {
    capturedAt: capturedAt.toISOString(),
    permission: "request.view",
    requestId: ids.request,
    ownerUserId: ids.actor,
    companyId: ids.company,
    branchId: ids.branch,
    departmentId: ids.department,
    active: true,
    scope: {
      type: "DEPARTMENT",
      companyId: ids.company,
      branchId: ids.branch,
      departmentId: ids.department,
    },
  };
}

function creationSnapshot() {
  return {
    capturedAt: capturedAt.toISOString(),
    companyId: ids.company,
    companyName: "Northwind Services",
    branchId: ids.branch,
    branchName: "Cyberjaya",
    departmentId: ids.department,
    departmentName: "Operations",
    taxRate: 8,
    estimatedDeliveryFee: 20,
    scope: {
      type: "DEPARTMENT",
      companyId: ids.company,
      branchId: ids.branch,
      departmentId: ids.department,
    },
  };
}

describe("request isolation service", () => {
  it("validates one canonical request scope and rejects mismatched or leaked data", () => {
    expect(requestIsolationInternals.requestResourceContextSchema.safeParse(
      resourceSnapshot(),
    ).success).toBe(true);

    expect(requestIsolationInternals.requestResourceContextSchema.safeParse({
      ...resourceSnapshot(),
      scope: {
        ...resourceSnapshot().scope,
        departmentId: ids.otherUser,
      },
    }).success).toBe(false);

    expect(requestIsolationInternals.requestResourceContextSchema.safeParse({
      ...resourceSnapshot(),
      token: "must-not-be-returned",
    }).success).toBe(false);

    expect(requestIsolationInternals.requestCreationContextSchema.safeParse({
      ...creationSnapshot(),
      scope: {
        type: "BRANCH",
        companyId: ids.company,
        branchId: ids.branch,
      },
    }).success).toBe(false);
  });

  it("enforces requester ownership while preserving department containment", () => {
    const subject = requesterSubject();
    const ownRequest = {
      companyId: ids.company,
      branchId: ids.branch,
      departmentId: ids.department,
      createdById: ids.actor,
    };
    const otherRequest = {
      ...ownRequest,
      createdById: ids.otherUser,
    };
    const siblingDepartment = {
      ...ownRequest,
      departmentId: ids.otherUser,
    };

    expect(requestIsolationInternals.permissionAllowed(
      subject,
      "request.view",
      ownRequest,
      capturedAt,
    )).toBe(true);
    expect(requestIsolationInternals.permissionAllowed(
      subject,
      "request.view",
      otherRequest,
      capturedAt,
    )).toBe(false);
    expect(requestIsolationInternals.permissionAllowed(
      subject,
      "request.view",
      siblingDepartment,
      capturedAt,
    )).toBe(false);
  });

  it("minimizes finance, supplier, quotation, and internal-cost fields independently", () => {
    const request = {
      id: ids.request,
      createdById: ids.actor,
      orderCode: "ORD-045",
      requestDate: "2026-08-07",
      requestType: "Standard" as const,
      companyId: ids.company,
      companyName: "Northwind Services",
      branchId: ids.branch,
      branchName: "Cyberjaya",
      departmentId: ids.department,
      department: "Operations",
      requestedBy: "Scoped requester",
      requesterContact: "requester@example.test",
      neededByDate: "2026-08-10",
      urgency: "Normal" as const,
      status: "New Request" as const,
      approvalStatus: "Pending" as const,
      estimatedTotal: 100,
      invoiceStatus: "Issued" as const,
      paymentStatus: "Unpaid" as const,
      invoiceNumber: "INV-SECRET",
      lines: [{
        id: "80000000-0000-4000-8000-000000000045",
        code: "REQ-045",
        productId: "81000000-0000-4000-8000-000000000045",
        productCode: "INTERNAL-PRODUCT-045",
        productName: "A4 paper",
        category: "Office",
        quantity: 5,
        unit: "Ream",
        supplierId: "90000000-0000-4000-8000-000000000045",
        supplierName: "Private supplier",
        quotationReference: "PRIVATE-QUOTE",
        supplierConfirmationStatus: "Confirmed",
        unitBuyPrice: 10,
        unitSellPrice: 14,
        deliveryCharge: 7,
        deliveryStatus: "Not Scheduled" as const,
        quantityReceived: 0,
      }],
    };

    const minimized = requestIsolationInternals.minimizeDemoRequest(
      requesterSubject(),
      request,
      capturedAt,
    );
    expect(minimized).toMatchObject({
      invoiceStatus: undefined,
      paymentStatus: undefined,
      invoiceNumber: undefined,
    });
    expect(minimized.lines[0]).toMatchObject({
      productId: undefined,
      productCode: undefined,
      supplierId: undefined,
      supplierName: undefined,
      quotationReference: undefined,
      supplierConfirmationStatus: undefined,
      unitBuyPrice: 0,
      deliveryCharge: 0,
      unitSellPrice: 14,
    });
  });

  it("loads exact lock decisions and collapses missing or malformed outcomes", async () => {
    const resourceClient = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ snapshot: resourceSnapshot() }],
      }),
    };
    const resource = await lockRequestResourceAccess(
      resourceClient as never,
      actor,
      {
        permission: "request.view",
        requestId: ids.request,
        capturedAt,
      },
    );
    expect(resource.requestId).toBe(ids.request);
    expect(resourceClient.query).toHaveBeenCalledWith(
      expect.stringContaining("axora_lock_request_resource_access"),
      [ids.actor, ids.assignment, "request.view", ids.request, capturedAt],
    );

    const creationClient = {
      query: vi.fn().mockResolvedValue({
        rowCount: 1,
        rows: [{ snapshot: creationSnapshot() }],
      }),
    };
    const creation = await lockRequestCreationScope(
      creationClient as never,
      actor,
      {
        companyId: ids.company,
        branchId: ids.branch,
        departmentId: ids.department,
        capturedAt,
      },
    );
    expect(creation.departmentName).toBe("Operations");

    const deniedClient = {
      query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ snapshot: null }] }),
    };
    await expect(lockRequestResourceAccess(
      deniedClient as never,
      actor,
      {
        permission: "request.view",
        requestId: ids.request,
        capturedAt,
      },
    )).rejects.toBeInstanceOf(RequestAccessUnavailableError);

    await expect(lockRequestResourceAccess(
      resourceClient as never,
      actor,
      {
        permission: "request.view",
        requestId: "not-a-uuid",
        capturedAt,
      },
    )).rejects.toBeInstanceOf(RequestAccessUnavailableError);
  });
});
