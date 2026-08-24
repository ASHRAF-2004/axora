import { beforeEach, describe, expect, it } from "vitest";

import {
  BranchDeliveryLocationUnavailableError,
  branchDeliveryLocationInternals,
  loadBranchDeliveryLocationWorkspace,
  saveBranchDeliveryLocation,
} from "@/lib/branch-delivery-location";
import type { AuthenticatedSessionUser } from "@/lib/auth";

const ids = {
  branch: "10000000-0000-4000-8000-000000000001",
  company: "10000000-0000-4000-8000-000000000002",
  command: "10000000-0000-4000-8000-000000000003",
  location: "10000000-0000-4000-8000-000000000004",
};
const capturedAt = new Date("2026-08-20T02:03:04.000Z");
const demoOwner: AuthenticatedSessionUser = {
  id: "70000000-0000-4000-8000-000000000001",
  email: "owner@axora.e2e",
  name: "Demo owner",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  isOwner: true,
  authVersion: 1,
};

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    capturedAt: capturedAt.toISOString(),
    companyId: ids.company,
    branchId: ids.branch,
    branchName: "Kuala Lumpur",
    canManage: true,
    commandId: ids.command,
    location: {
      id: ids.location,
      addressLabel: "Axora receiving bay",
      latitude: "3.139000",
      longitude: "101.686900",
      instructions: "Use the guarded receiving entrance.",
      updatedAt: capturedAt.toISOString(),
    },
    ...overrides,
  };
}

describe("branch delivery location capability parsing", () => {
  it("normalizes only a matching, paired, bounded database snapshot", () => {
    const result = branchDeliveryLocationInternals.parseWorkspace(
      workspace(),
      ids.branch,
      capturedAt,
    );

    expect(result.location?.coordinates).toEqual({
      latitude: 3.139,
      longitude: 101.6869,
    });
    expect(result.location?.addressLabel).toBe("Axora receiving bay");
    expect(result.commandId).toBe(ids.command);
  });

  it("accepts migration 113 snapshots whose null optional fields were stripped", () => {
    const withoutInstructions = { ...workspace().location as Record<string, unknown> };
    delete withoutInstructions.instructions;
    const result = branchDeliveryLocationInternals.parseWorkspace(
      workspace({ location: withoutInstructions }),
      ids.branch,
      capturedAt,
    );

    expect(result.location).toMatchObject({
      addressLabel: "Axora receiving bay",
      coordinates: { latitude: 3.139, longitude: 101.6869 },
    });
    expect(result.location?.instructions).toBeUndefined();
  });

  it("fails closed on branch/time confusion and malformed coordinate pairs", () => {
    expect(() => branchDeliveryLocationInternals.parseWorkspace(
      workspace({ branchId: ids.company }),
      ids.branch,
      capturedAt,
    )).toThrow("unavailable");
    expect(() => branchDeliveryLocationInternals.parseWorkspace(
      workspace(),
      ids.branch,
      new Date("2026-08-20T02:03:05.000Z"),
    )).toThrow("unavailable");
    expect(() => branchDeliveryLocationInternals.parseWorkspace(
      workspace({
        location: {
          ...workspace().location as object,
          longitude: null,
        },
      }),
      ids.branch,
      capturedAt,
    )).toThrow("unavailable");
    expect(() => branchDeliveryLocationInternals.parseWorkspace(
      workspace({
        location: {
          ...workspace().location as object,
          latitude: "91.000000",
        },
      }),
      ids.branch,
      capturedAt,
    )).toThrow("unavailable");
  });
});

describe("branch delivery location mutation validation", () => {
  beforeEach(() => {
    global.__axoraDemoDeliveryLocationState = undefined;
  });

  it("accepts explicit operational fields and bounded coordinates", () => {
    expect(branchDeliveryLocationInternals.saveInputSchema.parse({
      branchId: ids.branch,
      addressLabel: "Receiving bay 4",
      coordinates: { latitude: 3.139, longitude: 101.6869 },
      instructions: "Call security at the gate.",
      reason: "Confirmed canonical delivery point",
      commandId: ids.command,
    })).toMatchObject({ branchId: ids.branch });
  });

  it.each([
    { addressLabel: "Receiving\u0000 bay" },
    { coordinates: { latitude: 90.000001, longitude: 0 } },
    { coordinates: { latitude: 0, longitude: -180.000001 } },
    { reason: "  " },
  ])("rejects unsafe or incomplete mutation input %#", (override) => {
    expect(branchDeliveryLocationInternals.saveInputSchema.safeParse({
      branchId: ids.branch,
      addressLabel: "Receiving bay 4",
      coordinates: { latitude: 3.139, longitude: 101.6869 },
      instructions: "Call security at the gate.",
      reason: "Confirmed canonical delivery point",
      commandId: ids.command,
      ...override,
    }).success).toBe(false);
  });

  it("persists a scoped demo save and replays one command without another mutation", async () => {
    const commandId = "70000000-0000-4000-8000-000000000002";
    const input = {
      branchId: "br-youruni-main",
      addressLabel: "Demo receiving gate",
      coordinates: { latitude: 3.139, longitude: 101.6869 },
      instructions: "Use the guarded entrance.",
      reason: "Confirm demo delivery point",
      commandId,
    };
    const first = await saveBranchDeliveryLocation(demoOwner, input);
    const replay = await saveBranchDeliveryLocation(demoOwner, input);
    const reloaded = await loadBranchDeliveryLocationWorkspace(
      demoOwner,
      input.branchId,
    );

    expect(first.location).toEqual(replay.location);
    expect(reloaded?.location).toMatchObject({
      addressLabel: input.addressLabel,
      coordinates: input.coordinates,
    });
    expect(global.__axoraDemoDeliveryLocationState?.commands.size).toBe(1);

    await expect(saveBranchDeliveryLocation(demoOwner, {
      ...input,
      addressLabel: "Conflicting command payload",
    })).rejects.toBeInstanceOf(BranchDeliveryLocationUnavailableError);
  });

  it("does not let a different company administrator update a demo branch", async () => {
    const otherCompanyAdmin: AuthenticatedSessionUser = {
      ...demoOwner,
      id: "70000000-0000-4000-8000-000000000003",
      email: "admin@excel.example",
      role: "COMPANY_ADMIN",
      accountKind: "COMPANY",
      scopeType: "COMPANY",
      companyId: "co-excel",
      isOwner: false,
    };
    await expect(saveBranchDeliveryLocation(otherCompanyAdmin, {
      branchId: "br-youruni-main",
      addressLabel: "Forged destination",
      coordinates: { latitude: 1, longitude: 1 },
      reason: "Attempt a cross-company update",
      commandId: "70000000-0000-4000-8000-000000000004",
    })).rejects.toBeInstanceOf(BranchDeliveryLocationUnavailableError);
  });

  it("allows a platform CAM to view any company location without assignment", async () => {
    const unassignedCam: AuthenticatedSessionUser = {
      ...demoOwner,
      id: "70000000-0000-4000-8000-000000000005",
      email: "unassigned-cam@axora.invalid",
      role: "CLIENT_ACCOUNT_MANAGER",
      accountKind: "PLATFORM",
      scopeType: "PLATFORM",
      isOwner: false,
    };

    await expect(loadBranchDeliveryLocationWorkspace(
      unassignedCam,
      "br-youruni-main",
    )).resolves.toMatchObject({ branchId: "br-youruni-main", canManage: false });
  });
});
