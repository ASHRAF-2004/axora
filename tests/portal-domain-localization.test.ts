import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(portal)/budgets/actions", () => ({
  decideBudgetAdjustmentAction: vi.fn(),
  decideBudgetCycleChangeAction: vi.fn(),
  decideVariancePolicyChangeAction: vi.fn(),
  requestBudgetAdjustmentAction: vi.fn(),
  requestBudgetCycleChangeAction: vi.fn(),
  requestVariancePolicyChangeAction: vi.fn(),
  rerunBudgetRefreshJobAction: vi.fn(),
}));

vi.mock("@/app/(portal)/approvals/actions", () => ({
  decideRequestActualAction: vi.fn(),
}));

import { BudgetCycleManagement } from "@/components/BudgetCycleManagement";
import { VarianceApprovalPanel } from "@/components/VarianceApprovalPanel";
import { ManageDriversPanel } from "@/components/role-portals/ManageDriversPanel";
import {
  budgetAdjustmentTypeLabel,
  budgetAlertStateLabel,
  budgetBooleanLabel,
  budgetFrequencyLabel,
  budgetPeriodStatusLabel,
  budgetRefreshJobStateLabel,
  budgetRolloverModeLabel,
  budgetThresholdLabel,
  budgetToleranceModeLabel,
  budgetWorkflowStateLabel,
} from "@/lib/budget-cycle-variance-i18n";
import type { BudgetCycleWorkspace } from "@/lib/budget-cycles";
import type { ProcurementVarianceApprovalWorkspace } from "@/lib/budget-variance";
import { companyLifecycleMessages } from "@/lib/company-lifecycle-i18n";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import {
  deliveryProofTypeLabel,
  deliveryWorkflowStatusLabel,
} from "@/lib/delivery-workflow-i18n";
import {
  driverAvailabilityLabel,
  driverRecoveryReasonLabel,
} from "@/lib/driver-management-i18n";

const budgetWorkspace = {
  capturedAt: "2026-08-27T00:00:00.000Z",
  accounts: [{
    id: "10000000-0000-4000-8000-000000000001",
    companyId: "20000000-0000-4000-8000-000000000001",
    name: "Main branch budget",
    code: "MAIN",
    currency: "MYR",
    levelType: "BRANCH",
    canRequest: false,
    canApprove: false,
    canRefresh: false,
    schedule: {
      id: "30000000-0000-4000-8000-000000000001",
      version: 1,
      frequency: "MONTHLY",
      intervalCount: 1,
      timezone: "Asia/Kuala_Lumpur",
      anchorLocal: "2026-08-01 00:00:00",
      dstResolution: "EARLIER",
      fixedAllocation: "1000.00",
      rolloverMode: "RESET_FIXED",
      lowThresholdPercentage: 25,
      criticalThresholdPercentage: 10,
      hysteresisPercentage: 5,
      effectiveAt: "2026-08-01T00:00:00.000Z",
    },
    nextRefreshAt: "2026-09-01T00:00:00.000Z",
    periods: [{
      id: "40000000-0000-4000-8000-000000000001",
      name: "August 2026",
      startsAt: "2026-08-01T00:00:00.000Z",
      endsAt: "2026-09-01T00:00:00.000Z",
      status: "ACTIVE",
      scheduleVersion: 1,
      allocated: "1000.00",
      available: "900.00",
      reserved: "0.00",
      spent: "100.00",
    }],
  }],
  changeRequests: [{
    id: "50000000-0000-4000-8000-000000000001",
    budgetAccountId: "10000000-0000-4000-8000-000000000001",
    accountName: "Main branch budget",
    state: "PENDING_AXORA",
    requestedBy: "Company administrator",
    requestedById: "60000000-0000-4000-8000-000000000001",
    reason: "Fixture",
    config: {},
    effectiveAt: "2026-09-01T00:00:00.000Z",
    createdAt: "2026-08-27T00:00:00.000Z",
    canDecide: false,
  }],
  jobs: [{
    id: "70000000-0000-4000-8000-000000000001",
    budgetAccountId: "10000000-0000-4000-8000-000000000001",
    accountName: "Main branch budget",
    state: "DEAD_LETTER",
    dueAt: "2026-09-01T00:00:00.000Z",
    nextAttemptAt: "2026-09-01T00:00:00.000Z",
    attemptCount: 6,
    maxAttempts: 6,
    lastErrorCode: "WORKER_RETRY_EXHAUSTED",
    manualRerunCount: 0,
    canRerun: false,
  }],
  alerts: [{
    id: "80000000-0000-4000-8000-000000000001",
    budgetAccountId: "10000000-0000-4000-8000-000000000001",
    accountName: "Main branch budget",
    thresholdCode: "LOW",
    active: true,
    lastAvailable: "100.00",
    notificationCount: 1,
  }],
  variancePolicies: [{
    id: "90000000-0000-4000-8000-000000000001",
    companyId: "20000000-0000-4000-8000-000000000001",
    companyName: "Fixture company",
    version: 1,
    toleranceMode: "LOWER_ONLY",
    effectiveAt: "2026-08-01T00:00:00.000Z",
    canRequest: false,
  }],
  variancePolicyChanges: [],
  adjustmentRequests: [{
    id: "a0000000-0000-4000-8000-000000000001",
    budgetAccountId: "10000000-0000-4000-8000-000000000001",
    accountName: "Main branch budget",
    state: "RETURNED",
    adjustmentType: "ONE_TIME",
    amount: "25.00",
    requestedBy: "Company administrator",
    requestedById: "60000000-0000-4000-8000-000000000001",
    reason: "Fixture",
    createdAt: "2026-08-27T00:00:00.000Z",
    canDecide: false,
  }],
} satisfies BudgetCycleWorkspace;

const varianceWorkspace = {
  capturedAt: "2026-08-27T00:00:00.000Z",
  submissions: [{
    id: "b0000000-0000-4000-8000-000000000001",
    requestId: "c0000000-0000-4000-8000-000000000001",
    requestNumber: "REQ-LOCALIZED-001",
    companyName: "Fixture company",
    branchName: "Main branch",
    currency: "MYR",
    state: "PENDING_COMPANY",
    approvalRevision: 1,
    estimateAmount: "10.00",
    previousActualAmount: "0.00",
    submissionAmount: "10.00",
    cumulativeActualAmount: "10.00",
    differenceAmount: "0.00",
    withinTolerance: true,
    substitutePresent: false,
    receiptProvided: true,
    notes: "Fixture",
    submittedBy: "Fulfilment fixture",
    submittedAt: "2026-08-27T00:00:00.000Z",
    lines: [{
      id: "d0000000-0000-4000-8000-000000000001",
      estimatedProductName: "Paper",
      actualProductName: "Paper",
      quantity: 1,
      unitOfMeasure: "Pack",
      customerUnitPrice: "10.00",
      taxAmount: "0.00",
      deliveryCharge: "0.00",
      otherCharge: "0.00",
      lineTotal: "10.00",
    }],
    sourceAccounts: [],
  }],
} satisfies ProcurementVarianceApprovalWorkspace;

describe("portal domain localization boundaries", () => {
  it("localizes every persisted budget code and uses a safe localized fallback", () => {
    for (const locale of ["en", "ar", "ms"] as const) {
      for (const value of ["WEEKLY", "MONTHLY", "QUARTERLY", "ANNUAL", "YEARLY", "CUSTOM", "MANUAL"]) {
        expect(budgetFrequencyLabel(value, locale)).not.toBe(value);
      }
      for (const value of ["RESET_FIXED", "FULL", "NONE", "PARTIAL_PERCENT", "CUSTOM_AMOUNT"]) {
        expect(budgetRolloverModeLabel(value, locale)).not.toBe(value);
      }
      for (const value of ["NONE", "FIXED", "PERCENTAGE", "LOWER_ONLY"]) {
        expect(budgetToleranceModeLabel(value, locale)).not.toBe(value);
      }
      for (const value of ["ONE_TIME", "TEMPORARY", "PERMANENT", "TRANSFER"]) {
        expect(budgetAdjustmentTypeLabel(value, locale)).not.toBe(value);
      }
      for (const value of ["PENDING_COMPANY", "PENDING_AXORA", "APPROVED", "REJECTED", "RETURNED", "FINALIZED"]) {
        expect(budgetWorkflowStateLabel(value, locale)).not.toBe(value);
      }
      for (const value of ["SCHEDULED", "ACTIVE", "CLOSED", "FAILED", "CORRECTED"]) {
        expect(budgetPeriodStatusLabel(value, locale)).not.toBe(value);
      }
      for (const value of ["PENDING", "LEASED", "RETRY", "SUCCEEDED", "DEAD_LETTER", "CANCELLED"]) {
        expect(budgetRefreshJobStateLabel(value, locale)).not.toBe(value);
      }
      for (const value of ["LOW", "CRITICAL", "ZERO", "NEGATIVE"]) {
        expect(budgetThresholdLabel(value, locale)).not.toBe(value);
      }
      expect(budgetAlertStateLabel(true, locale)).not.toBe("ACTIVE");
      expect(budgetBooleanLabel(false, locale)).not.toBe("NO");
      expect(budgetWorkflowStateLabel("FUTURE_DATABASE_STATE", locale)).not.toContain("FUTURE");
    }
  });

  it("renders Arabic budget workflow labels without exposing operational codes", () => {
    const budgetHtml = renderToStaticMarkup(createElement(BudgetCycleManagement, {
      workspace: budgetWorkspace,
      locale: "ar",
    }));
    const varianceHtml = renderToStaticMarkup(createElement(VarianceApprovalPanel, {
      workspace: varianceWorkspace,
      locale: "ar",
    }));

    expect(budgetHtml).toContain("شهري");
    expect(budgetHtml).toContain("إعادة التعيين إلى المخصص الثابت");
    expect(budgetHtml).toContain("بانتظار اعتماد أكسورا");
    expect(budgetHtml).toContain("تحتاج إلى استعادة يدوية");
    expect(budgetHtml).toContain("رصيد منخفض");
    expect(budgetHtml).not.toMatch(/>(?:RESET_FIXED|PENDING_AXORA|DEAD_LETTER|WORKER_RETRY_EXHAUSTED|LOW|ACTIVE)</);
    expect(varianceHtml).toContain("بانتظار اعتماد الشركة");
    expect(varianceHtml).toContain("نعم");
    expect(varianceHtml).toContain("لا");
    expect(varianceHtml).not.toMatch(/>(?:PENDING_COMPANY|YES|NO)</);
  });

  it("renders localized driver availability, workflow and recovery reasons", () => {
    const html = renderToStaticMarkup(createElement(ManageDriversPanel, { locale: "ar", initialWorkspace: {
      sequence: 1,
      capturedAt: "2026-08-27T00:00:00.000Z",
      drivers: [{
        id: "e0000000-0000-4000-8000-000000000001",
        name: "Delivery fixture",
        email: "delivery.fixture@axora.invalid",
        phone: "+60120000000",
        active: true,
        availability: "OFFLINE",
        currentJobId: "f0000000-0000-4000-8000-000000000001",
        currentJobCode: "DEL-LOCALIZED-001",
        currentJobStatus: "OUT_FOR_DELIVERY",
        completedJobs: 2,
        locationStale: true,
      }],
    } }));

    expect(html).toContain("غير متصل");
    expect(html).toContain("خرج للتسليم");
    expect(html).not.toMatch(/>(?:OFFLINE|OUT_FOR_DELIVERY)</);
    expect(driverAvailabilityLabel("FUTURE_STATE", "ar")).toBe("حالة التوافر غير متاحة");
    expect(driverRecoveryReasonLabel("TRACKING_STALE", "ms")).toContain("penjejakan");
    expect(deliveryWorkflowStatusLabel("FUTURE_STATE", "ms")).toBe("Status penghantaran tidak tersedia");
    expect(deliveryProofTypeLabel("PHOTO", "ar")).toBe("صورة");
    expect(deliveryProofTypeLabel("SIGNATURE", "ms")).toBe("Tandatangan");
    expect(deliveryProofTypeLabel("OTP", "ar")).toBe("رمز مستلم للاستخدام مرة واحدة");
    expect(deliveryProofTypeLabel("FUTURE_PROOF", "ms")).toBe("Jenis bukti tidak tersedia");
  });

  it("renders Delivery Agent location time in the explicit profile timezone", () => {
    const workspace = {
      sequence: 1,
      capturedAt: "2026-08-27T00:00:00.000Z",
      drivers: [{
        id: "e0000000-0000-4000-8000-000000000001",
        name: "Delivery fixture",
        email: "delivery.fixture@axora.invalid",
        phone: "+60120000000",
        active: true,
        availability: "AVAILABLE" as const,
        completedJobs: 1,
        lastLocationAt: "2026-08-26T08:15:00.000Z",
        locationStale: true,
      }],
    };

    const utcHtml = renderToStaticMarkup(createElement(ManageDriversPanel, {
      initialWorkspace: workspace,
      locale: "en",
      timeZone: "UTC",
    }));
    const malaysiaHtml = renderToStaticMarkup(createElement(ManageDriversPanel, {
      initialWorkspace: workspace,
      locale: "en",
      timeZone: "Asia/Kuala_Lumpur",
    }));

    expect(utcHtml).toContain("Aug 26, 2026, 8:15 AM");
    expect(malaysiaHtml).toContain("Aug 26, 2026, 4:15 PM");
  });

  it("localizes create-route navigation and unavailable-company recovery copy", () => {
    expect(companyLifecycleMessages("ar").back).toBe("العودة إلى الشركات");
    expect(corePortalMessages("ar").common).toMatchObject({
      back: "رجوع",
      continue: "متابعة",
      companyUnavailable: "الشركة المعيّنة غير متاحة أو غير نشطة.",
    });
    expect(corePortalMessages("ms").common).toMatchObject({
      back: "Kembali",
      continue: "Teruskan",
    });
  });
});
