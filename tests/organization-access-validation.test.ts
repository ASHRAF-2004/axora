import { describe, expect, it } from "vitest";
import {
  OrganizationAccessUnavailableError,
  organizationAccessInternals,
} from "@/lib/organization-access";

const ids = {
  company: "10000000-0000-4000-8000-000000000244",
  otherCompany: "20000000-0000-4000-8000-000000000244",
  branch: "30000000-0000-4000-8000-000000000244",
} as const;
const capturedAt = new Date("2026-08-07T07:00:00.000Z");

function company() {
  return {
    id: ids.company,
    code: "C-244",
    name: "Northwind Services",
    industry: "Facilities",
    mainContactName: "Operations Lead",
    mainContactEmail: "operations@example.test",
    mainContactPhone: "+601100000001",
    billingContactName: "Finance Lead",
    billingContactEmail: "finance@example.test",
    billingContactPhone: "+601100000002",
    billingAddress: "Cyberjaya",
    paymentTerms: "Standard billing terms",
    billingCycle: "Monthly",
    taxRate: 0,
    estimatedDeliveryFee: 15,
    status: "Active",
  };
}

function branch() {
  return {
    id: ids.branch,
    code: "B-244",
    companyId: ids.company,
    companyName: "Northwind Services",
    name: "Cyberjaya",
    branchCode: "CYB-244",
    deliveryAddress: "Cyberjaya",
    city: "Cyberjaya",
    contactName: "Branch Lead",
    contactPhone: "+601100000003",
    contactEmail: "branch@example.test",
    canViewBudget: false,
    status: "Active",
  };
}

function branchAccess() {
  return {
    capturedAt: capturedAt.toISOString(),
    permission: "organization.branch.view",
    resourceType: "BRANCH",
    resourceId: ids.branch,
    active: true,
    scope: {
      type: "BRANCH",
      companyId: ids.company,
      branchId: ids.branch,
    },
  };
}

describe("organization snapshot structural validation", () => {
  it("accepts a matching resource and canonical scope", () => {
    expect(organizationAccessInternals.resourceAccessSchema.safeParse(
      branchAccess(),
    ).success).toBe(true);
  });

  it("rejects mismatched resource types, identifiers, and foreign scope keys", () => {
    expect(organizationAccessInternals.resourceAccessSchema.safeParse({
      ...branchAccess(),
      scope: {
        type: "COMPANY",
        companyId: ids.company,
      },
    }).success).toBe(false);

    expect(organizationAccessInternals.resourceAccessSchema.safeParse({
      ...branchAccess(),
      scope: {
        ...branchAccess().scope,
        branchId: ids.otherCompany,
      },
    }).success).toBe(false);

    expect(organizationAccessInternals.resourceAccessSchema.safeParse({
      ...branchAccess(),
      scope: {
        ...branchAccess().scope,
        supplierId: ids.otherCompany,
      },
    }).success).toBe(false);
  });

  it("rejects branch rows whose parent company is absent or renamed", () => {
    const valid = {
      capturedAt: capturedAt.toISOString(),
      companies: [company()],
      branches: [branch()],
    };
    expect(organizationAccessInternals.validateDirectory(
      valid,
      capturedAt,
    ).branches).toHaveLength(1);

    expect(() => organizationAccessInternals.validateDirectory({
      ...valid,
      companies: [],
    }, capturedAt)).toThrow(OrganizationAccessUnavailableError);

    expect(() => organizationAccessInternals.validateDirectory({
      ...valid,
      branches: [{ ...branch(), companyName: "Other tenant" }],
    }, capturedAt)).toThrow(OrganizationAccessUnavailableError);
  });
});
