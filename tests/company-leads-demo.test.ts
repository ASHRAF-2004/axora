import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({
  isDemoMode: () => true,
  query: vi.fn(),
  withAuditTransaction: vi.fn(),
}));

import type { AuthenticatedSessionUser } from "@/lib/auth";
import {
  addCompanyLeadNote,
  addCompanyLeadTask,
  assignCompanyLead,
  CompanyLeadCommandConflictError,
  convertCompanyLead,
  createAcquisitionLead,
  loadCompanyLeadWorkspace,
  transitionCompanyLead,
  type AcquisitionLeadInput,
} from "@/lib/company-leads";
import { loadCompanyLifecycleWorkspace } from "@/lib/company-lifecycle";

const owner = {
  id: "da100000-0000-4000-8000-000000000001",
  email: "owner@fixture.invalid",
  name: "Platform Owner",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  roleAssignmentId: "da100000-0000-4000-8000-000000000002",
  isOwner: true,
  authVersion: 1,
} satisfies AuthenticatedSessionUser;

const cam = {
  id: "20222222-2222-4222-8222-222222222222",
  email: "agent.fixture@axora.invalid",
  name: "Agent fixture",
  role: "CLIENT_ACCOUNT_MANAGER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  roleAssignmentId: "da100000-0000-4000-8000-000000000004",
  isOwner: false,
  authVersion: 1,
} satisfies AuthenticatedSessionUser;

const otherCam = {
  ...cam,
  id: "da100000-0000-4000-8000-000000000005",
  email: "other-cam@fixture.invalid",
  name: "Other Client Account Manager",
  roleAssignmentId: "da100000-0000-4000-8000-000000000006",
} satisfies AuthenticatedSessionUser;

const input = {
  companyName: "Owner-created prospect",
  legalName: "Owner-created prospect Sdn Bhd",
  contactName: "Company coordinator",
  city: "Kuala Lumpur",
  industry: "Business services",
  employeeRange: "11_50",
  branchRange: "2_5",
  spendRange: "50K_250K",
  locale: "en",
  timezone: "Asia/Kuala_Lumpur",
  subject: "Reviewed procurement opportunity",
  message: "Create a private lead after the Owner reviewed the enquiry.",
} satisfies AcquisitionLeadInput;

describe("company acquisition lead demo state", () => {
  beforeEach(() => {
    globalThis.__axoraDemoCompanyLeadState = undefined;
    globalThis.__axoraDemoCompanyManagerAssignments = undefined;
  });

  it("persists one Owner-created lead and replays the same command safely", async () => {
    const commandId = "da100000-0000-4000-8000-000000000010";
    const capturedAt = new Date("2026-08-21T05:30:00.000Z");
    const created = await createAcquisitionLead(owner,input,commandId,capturedAt);
    const replay = await createAcquisitionLead(owner,input,commandId,new Date(
      "2026-08-21T05:31:00.000Z",
    ));

    expect(created).toMatchObject({ status: "NEW" });
    expect(created.event.created).toBe(true);
    expect(replay).toMatchObject({ leadId: created.leadId, leadCode: created.leadCode });
    expect(replay.event.created).toBe(false);

    const workspace = await loadCompanyLeadWorkspace(owner,{});
    expect(workspace.leads).toHaveLength(1);
    expect(workspace.leads[0]).toMatchObject({
      id: created.leadId,
      source: "OWNER_CREATED",
      companyName: input.companyName,
      registrationNumber: "",
      contactEmail: "",
      phoneCountryCode: "",
      phone: null,
      country: "",
      region: "",
      preferredContactTime: "",
    });
    expect((await loadCompanyLeadWorkspace(owner,{ industry: "unrelated" })).leads)
      .toHaveLength(0);
    expect((await loadCompanyLeadWorkspace(cam,{})).leads).toHaveLength(0);
  });

  it("supports Owner assignment, scoped CAM visibility, follow-up, and conversion", async () => {
    const created = await createAcquisitionLead(
      owner,input,"da100000-0000-4000-8000-000000000012",
      new Date("2026-08-21T06:30:00.000Z"),
    );
    const ownerWorkspace = await loadCompanyLeadWorkspace(owner,{});
    expect(ownerWorkspace.managers).toEqual([{
      id: cam.id,name: cam.name,email: cam.email,
    }]);
    expect(ownerWorkspace.leads[0]?.availableActions).toEqual(
      expect.arrayContaining(["ASSIGN","MARK_CONTACTED","QUALIFY","ADD_NOTE","ADD_TASK"]),
    );

    await assignCompanyLead(
      owner,created.leadId,cam.id,"Owner assigned reviewed lead for follow-up",
    );
    expect((await loadCompanyLeadWorkspace(cam,{})).leads[0]).toMatchObject({
      id: created.leadId,
      status: "ASSIGNED",
      assignment: { managerId: cam.id },
    });
    expect((await loadCompanyLeadWorkspace(otherCam,{})).leads).toHaveLength(0);
    await expect(transitionCompanyLead(
      otherCam,created.leadId,"CONTACTED","Forged out-of-portfolio transition",
    )).rejects.toBeInstanceOf(Error);

    await addCompanyLeadNote(
      owner,created.leadId,"CONTACT_ATTEMPT","Owner recorded contact evidence.",
    );
    await addCompanyLeadTask(
      owner,created.leadId,"Prepare qualification summary",
      new Date(Date.now() + 60_000),cam.id,
    );
    await transitionCompanyLead(
      owner,created.leadId,"CONTACTED","Owner confirmed initial contact",
    );
    await transitionCompanyLead(
      owner,created.leadId,"QUALIFIED","Owner completed qualification review",
    );
    expect((await loadCompanyLeadWorkspace(owner,{})).leads[0]).toMatchObject({
      status: "QUALIFIED",
      notes: [{ note: "Owner recorded contact evidence." }],
      tasks: [{ title: "Prepare qualification summary",status: "OPEN" }],
    });

    const converted = await convertCompanyLead(
      owner,created.leadId,"Owner approved canonical company onboarding",
    );
    expect(converted).toMatchObject({
      leadId: created.leadId,status: "ONBOARDING",
    });
    expect(converted.companyId).toMatch(/^[0-9a-f-]{36}$/);
    expect((await loadCompanyLifecycleWorkspace(owner)).companies
      .some((company) => company.id === converted.companyId)).toBe(true);
    expect((await loadCompanyLifecycleWorkspace(cam)).companies
      .some((company) => company.id === converted.companyId)).toBe(true);
    expect((await loadCompanyLifecycleWorkspace(otherCam)).companies
      .some((company) => company.id === converted.companyId)).toBe(false);
  });

  it("rejects command reuse with a different normalized payload", async () => {
    const commandId = "da100000-0000-4000-8000-000000000011";
    await createAcquisitionLead(owner,input,commandId);
    await expect(createAcquisitionLead(owner,{
      ...input,
      companyName: "Different prospect",
    },commandId)).rejects.toBeInstanceOf(CompanyLeadCommandConflictError);
    expect((await loadCompanyLeadWorkspace(owner,{})).leads).toHaveLength(1);
  });
});
