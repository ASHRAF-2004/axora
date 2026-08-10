import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    readPersistentUpload: vi.fn(),
    appendWorkflowEvent: vi.fn(),
    notifyWorkflowAudience: vi.fn(),
    withAuditTransaction: vi.fn(
      async (_context: unknown, work: (client: typeof mocks.client) => unknown) => work(mocks.client),
    ),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  withAuditTransaction: mocks.withAuditTransaction,
}));

vi.mock("@/lib/persistent-files", () => ({
  readPersistentUpload: mocks.readPersistentUpload,
  removePersistentUpload: vi.fn(),
  storePersistentUpload: vi.fn(),
}));

vi.mock("@/lib/workflow-repository", () => ({
  appendWorkflowEvent: mocks.appendWorkflowEvent,
  notifyWorkflowAudience: mocks.notifyWorkflowAudience,
}));

import type { SessionUser } from "@/lib/auth";
import {
  confirmReceipt,
  getReceivingWorkspace,
  recordDriverEvent,
} from "@/lib/role-portals-repository";

const ids = {
  receiver: "20000000-0000-4000-8000-000000000001",
  driver: "30000000-0000-4000-8000-000000000001",
  company: "40000000-0000-4000-8000-000000000001",
  forgedCompany: "40000000-0000-4000-8000-000000000002",
  branch: "50000000-0000-4000-8000-000000000001",
  request: "60000000-0000-4000-8000-000000000001",
  requestLine: "61000000-0000-4000-8000-000000000001",
  job: "70000000-0000-4000-8000-000000000001",
  assignment: "71000000-0000-4000-8000-000000000001",
  device: "72000000-0000-4000-8000-000000000001",
  clientEvent: "73000000-0000-4000-8000-000000000001",
  serverEvent: "74000000-0000-4000-8000-000000000001",
  deliveryLine: "75000000-0000-4000-8000-000000000001",
};

const receiverActor: SessionUser = {
  id: ids.receiver,
  email: "receiver@example.test",
  name: "Receiver",
  role: "RECEIVING_USER",
  accountKind: "COMPANY",
  scopeType: "BRANCH",
  companyId: ids.company,
  branchId: ids.branch,
  isOwner: false,
};

const driverActor: SessionUser = {
  id: ids.driver,
  email: "driver@example.test",
  name: "Driver",
  role: "DELIVERY_DRIVER",
  accountKind: "DELIVERY",
  scopeType: "DELIVERY",
  isOwner: false,
};

describe("role portal repository boundaries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendWorkflowEvent.mockResolvedValue({
      id: "80000000-0000-4000-8000-000000000001",
      companyId: ids.company,
      requestId: ids.request,
      aggregateType: "request",
      aggregateId: ids.request,
      eventKey: "test.event",
      eventVersion: 1,
      correlationId: ids.request,
      occurredAt: "2026-08-02T08:00:00.000Z",
      created: true,
    });
    mocks.notifyWorkflowAudience.mockResolvedValue(1);
  });

  it("filters receiver work by both company and branch scope", async () => {
    mocks.client.query.mockResolvedValueOnce({ rows: [] });
    await getReceivingWorkspace(receiverActor);
    const workspaceQuery = mocks.client.query.mock.calls[0];
    expect(String(workspaceQuery[0])).toContain("job.company_id=$1");
    expect(String(workspaceQuery[0])).toContain("job.branch_id=$2");
    expect(String(workspaceQuery[0])).toContain("evidence_assignment.status IN ('ASSIGNED','ACCEPTED','COMPLETED')");
    expect(String(workspaceQuery[0])).toContain("ORDER BY event.received_at DESC,event.id DESC");
    expect(workspaceQuery[1]).toEqual([ids.company, ids.branch]);
  });

  it("presents driver handover details as non-authoritative receiving context", async () => {
    mocks.client.query.mockResolvedValueOnce({ rows: [{
      id: ids.job,
      companyId: ids.company,
      branchId: ids.branch,
      jobCode: "JOB-101",
      branchName: "Central branch",
      deliveredAt: "2026-08-02T08:00:00.000Z",
      driverEventType: "PARTIALLY_DELIVERED",
      driverMetadata: {
        receiverName: "Branch security desk",
        lineOutcomes: [{
          deliveryJobLineId: ids.deliveryLine,
          deliveredQuantity: 8,
          damagedQuantity: 1,
          missingQuantity: 2,
        }],
      },
      lines: [{
        id: ids.deliveryLine,
        requestLineId: ids.requestLine,
        productName: "Safety gloves",
        plannedQuantity: 10,
        unit: "box",
      }],
    }] });
    const workspace = await getReceivingWorkspace(receiverActor);
    expect(workspace[0]).toMatchObject({
      driverEventType: "PARTIALLY_DELIVERED",
      driverReportedReceiverName: "Branch security desk",
      lines: [{
        driverReportedDeliveredQuantity: 8,
        driverReportedDamagedQuantity: 1,
        driverReportedMissingQuantity: 2,
      }],
    });
    expect(workspace[0]).not.toHaveProperty("driverMetadata");
  });

  it("derives the event company from the assigned job and emits an idempotent safe workflow update", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM delivery_agent_profiles")) return { rows: [{ userId: ids.driver, active: true }] };
      if (sql.includes("FROM delivery_job_assignments assignment")) return { rows: [{
        id: ids.assignment,
        companyId: ids.company,
        branchId: ids.branch,
        requestId: ids.request,
        jobCode: "JOB-101",
        jobStatus: "ASSIGNED",
        deliveryJobId: ids.job,
        driverUserId: ids.driver,
        status: "ACCEPTED",
        assignedAt: "2026-08-02T07:00:00.000Z",
      }] };
      if (sql.includes("SELECT id::text,") && sql.includes("AS matches")) return { rows: [] };
      if (sql.includes("SELECT event_type AS \"eventType\"")) return { rows: [{ eventType: "ARRIVED" }] };
      if (sql.includes("INSERT INTO delivery_job_events")) return { rows: [{ id: ids.serverEvent }] };
      return { rows: [] };
    });
    const result = await recordDriverEvent(driverActor, {
      deliveryJobId: ids.job,
      assignmentId: ids.assignment,
      deviceId: ids.device,
      clientEventId: ids.clientEvent,
      deviceSequence: 4,
      eventType: "DELIVERED",
      clientRecordedAt: "2026-08-02T08:00:00.000Z",
    });
    expect(result.eventId).toBe(ids.serverEvent);
    const currentStateQuery = mocks.client.query.mock.calls.find(([sql]) =>
      String(sql).includes('SELECT event_type AS "eventType"'));
    expect(String(currentStateQuery?.[0])).toContain("ORDER BY received_at DESC,id DESC");
    const eventInsert = mocks.client.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO delivery_job_events"));
    if (!eventInsert) throw new Error("Expected delivery event insert query.");
    expect(eventInsert[1]?.[0]).toBe(ids.company);
    expect(eventInsert[1]).not.toContain(ids.forgedCompany);
    expect(mocks.appendWorkflowEvent).toHaveBeenCalledWith(mocks.client, expect.objectContaining({
      companyId: ids.company,
      branchId: ids.branch,
      requestId: ids.request,
      aggregateType: "delivery-job",
      aggregateId: ids.job,
      eventKey: "delivery.completed",
      stableKey: ids.clientEvent,
      metadata: { deliveryJobId: ids.job, deliveryEventId: ids.serverEvent },
    }));
    expect(mocks.appendWorkflowEvent).toHaveBeenCalledWith(mocks.client, expect.objectContaining({
      companyId: ids.company,
      branchId: ids.branch,
      requestId: ids.request,
      aggregateType: "delivery-job",
      aggregateId: ids.job,
      eventKey: "receipt.required",
      stableKey: `${ids.clientEvent}:receipt-required`,
      metadata: { deliveryJobId: ids.job, deliveryEventId: ids.serverEvent },
    }));
    expect(mocks.notifyWorkflowAudience).toHaveBeenCalledWith(mocks.client, expect.anything(), expect.objectContaining({
      audiences: ["COMPANY_RECEIVERS"],
      message: { key: "receipt_required", jobCode: "JOB-101" },
      routePath: "/receiving",
      priority: "HIGH",
    }));
  });

  it("keeps a historical offline event appendable after reassignment without exposing the job aggregate", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM delivery_agent_profiles")) return { rows: [{ userId: ids.driver, active: true }] };
      if (sql.includes("FROM delivery_job_assignments assignment")) return { rows: [{
        id: ids.assignment,
        companyId: ids.company,
        branchId: ids.branch,
        requestId: ids.request,
        jobCode: "JOB-101",
        jobStatus: "ASSIGNED",
        deliveryJobId: ids.job,
        driverUserId: ids.driver,
        status: "REASSIGNED",
        assignedAt: "2026-08-02T07:00:00.000Z",
        endedAt: "2026-08-02T08:05:00.000Z",
      }] };
      if (sql.includes("SELECT id::text,") && sql.includes("AS matches")) return { rows: [] };
      if (sql.includes("INSERT INTO delivery_job_events")) return { rows: [{ id: ids.serverEvent }] };
      return { rows: [] };
    });
    await recordDriverEvent(driverActor, {
      deliveryJobId: ids.job,
      assignmentId: ids.assignment,
      deviceId: ids.device,
      clientEventId: ids.clientEvent,
      deviceSequence: 5,
      eventType: "ARRIVED",
      clientRecordedAt: "2026-08-02T08:00:00.000Z",
    });
    expect(mocks.appendWorkflowEvent).toHaveBeenCalledWith(mocks.client, expect.objectContaining({
      aggregateType: "delivery-event",
      aggregateId: ids.serverEvent,
      requestId: ids.request,
    }));
  });

  it("persists partial driver quantities and handover name only as bounded evidence", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM delivery_agent_profiles")) return { rows: [{ userId: ids.driver, active: true }] };
      if (sql.includes("FROM delivery_job_assignments assignment")) return { rows: [{
        id: ids.assignment,
        companyId: ids.company,
        branchId: ids.branch,
        requestId: ids.request,
        jobCode: "JOB-101",
        jobStatus: "ASSIGNED",
        deliveryJobId: ids.job,
        driverUserId: ids.driver,
        status: "ACCEPTED",
        assignedAt: "2026-08-02T07:00:00.000Z",
      }] };
      if (sql.includes("FROM delivery_job_lines WHERE delivery_job_id")) {
        return { rows: [{ id: ids.deliveryLine, plannedQuantity: 10 }] };
      }
      if (sql.includes("SELECT id::text,") && sql.includes("AS matches")) return { rows: [] };
      if (sql.includes("SELECT event_type AS \"eventType\"")) return { rows: [{ eventType: "ARRIVED" }] };
      if (sql.includes("INSERT INTO delivery_job_events")) return { rows: [{ id: ids.serverEvent }] };
      return { rows: [] };
    });
    await recordDriverEvent(driverActor, {
      deliveryJobId: ids.job,
      assignmentId: ids.assignment,
      deviceId: ids.device,
      clientEventId: ids.clientEvent,
      deviceSequence: 6,
      eventType: "PARTIALLY_DELIVERED",
      clientRecordedAt: "2026-08-02T08:00:00.000Z",
      receiverName: "Branch security desk",
      lineOutcomes: [{
        deliveryJobLineId: ids.deliveryLine,
        deliveredQuantity: 8,
        damagedQuantity: 1,
        missingQuantity: 2,
      }],
    });
    const eventInsert = mocks.client.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO delivery_job_events"));
    if (!eventInsert) throw new Error("Expected partial delivery event insert query.");
    expect(eventInsert[1]?.[9]).toEqual({
      receiverName: "Branch security desk",
      lineOutcomes: [{
        deliveryJobLineId: ids.deliveryLine,
        deliveredQuantity: 8,
        damagedQuantity: 1,
        missingQuantity: 2,
      }],
    });
    expect(eventInsert[1]?.[9]).not.toHaveProperty("acceptedQuantity");
    expect(mocks.appendWorkflowEvent).toHaveBeenCalledWith(mocks.client, expect.objectContaining({
      eventKey: "delivery.partially_delivered",
      aggregateType: "delivery-job",
    }));
  });

  it("opens a receipt discrepancy without treating driver evidence as confirmation", async () => {
    mocks.client.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM delivery_jobs job")) return { rows: [{ companyId: ids.company, branchId: ids.branch, requestId: ids.request, jobCode: "JOB-101" }] };
      if (sql.includes("FROM delivery_job_lines")) return { rows: [{ id: ids.deliveryLine, requestLineId: ids.requestLine, plannedQuantity: 10 }] };
      return { rows: [], rowCount: 1 };
    });
    await confirmReceipt(receiverActor, {
      deliveryJobId: ids.job,
      lines: [{
        deliveryJobLineId: ids.deliveryLine,
        requestLineId: ids.requestLine,
        deliveredQuantity: 8,
        acceptedQuantity: 8,
        damagedQuantity: 0,
      }],
    });
    const jobLookup = mocks.client.query.mock.calls.find(([sql]) => String(sql).includes("FROM delivery_jobs job"));
    expect(jobLookup?.[1]).toEqual([ids.job, ids.company, ids.branch]);
    expect(String(jobLookup?.[0])).toContain("event.event_type IN ('PARTIALLY_DELIVERED','DELIVERED')");
    const workflowInput = mocks.appendWorkflowEvent.mock.calls[0]?.[1];
    expect(workflowInput).toMatchObject({
      aggregateType: "receipt",
      eventKey: "discrepancy.opened",
      metadata: { deliveryJobId: ids.job, receiptStatus: "ACCEPTED_WITH_EXCEPTIONS", receiptLineCount: 1 },
    });
    expect(JSON.stringify(workflowInput)).not.toContain("evidence");
  });
});
