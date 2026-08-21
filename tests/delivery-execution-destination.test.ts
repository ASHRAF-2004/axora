import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  deliveryExecutionDestinationInternals,
  type DeliveryExecutionWorkspace,
} from "@/lib/delivery-execution";

const jobId = "10000000-0000-4000-8000-000000000001";
const otherJobId = "10000000-0000-4000-8000-000000000002";

function job(id = jobId): DeliveryExecutionWorkspace["jobs"][number] {
  return {
    id,
    code: "DEL-001",
    status: "OUT_FOR_DELIVERY",
    workflowVersion: 4,
    assignmentId: "10000000-0000-4000-8000-000000000003",
    requestId: "10000000-0000-4000-8000-000000000004",
    destinationTimezone: "Asia/Kuala_Lumpur",
    evidence: [],
  };
}

describe("delivery destination snapshot projection", () => {
  it("attaches bounded numeric coordinates only to an assigned workspace job", () => {
    const result = deliveryExecutionDestinationInternals.attachDestinationCoordinates(
      [job()],
      [
        { id: jobId, destinationLatitude: "3.139000", destinationLongitude: "101.686900" },
        { id: otherJobId, destinationLatitude: "4", destinationLongitude: "102" },
      ],
    );

    expect(result[0]).toMatchObject({
      destinationLatitude: 3.139,
      destinationLongitude: 101.6869,
    });
    expect(result).toHaveLength(1);
  });

  it("leaves a legacy paired-null destination absent", () => {
    expect(deliveryExecutionDestinationInternals.attachDestinationCoordinates(
      [job()],
      [{ id: jobId, destinationLatitude: null, destinationLongitude: null }],
    )[0]).not.toHaveProperty("destinationLatitude");
  });

  it.each([
    { destinationLatitude: "3.139", destinationLongitude: null },
    { destinationLatitude: null, destinationLongitude: "101.6869" },
    { destinationLatitude: "90.000001", destinationLongitude: "0" },
    { destinationLatitude: "0", destinationLongitude: "180.000001" },
    { destinationLatitude: "not-a-coordinate", destinationLongitude: "101.6869" },
  ])("fails closed on an invalid assigned destination %#", (coordinates) => {
    expect(() => deliveryExecutionDestinationInternals.attachDestinationCoordinates(
      [job()],
      [{ id: jobId, ...coordinates }],
    )).toThrow("unavailable");
  });
});

describe("delivery evidence replay storage selection", () => {
  it("removes the newly staged file, never the durable replay path", () => {
    const stagedPath = "delivery-evidence/new/request-file.jpg";
    const durablePath = "delivery-evidence/existing/durable-file.jpg";
    expect(deliveryExecutionDestinationInternals.stagedEvidenceReplayPath({
      created: false,
      evidenceId: jobId,
      storagePath: durablePath,
      version: 1,
    }, stagedPath)).toBe(stagedPath);
    expect(deliveryExecutionDestinationInternals.stagedEvidenceReplayPath({
      created: true,
      evidenceId: jobId,
      storagePath: stagedPath,
      version: 1,
    }, stagedPath)).toBeNull();
  });

  it("fails closed when persisted evidence bytes, MIME, or digest no longer match", () => {
    const bytes = Buffer.from("%PDF-1.7\nfixture\n%%EOF");
    const digest = createHash("sha256").update(bytes).digest("hex");
    expect(deliveryExecutionDestinationInternals.deliveryEvidenceBytesMatch(
      "application/pdf",
      bytes,
      digest,
    )).toBe(true);
    expect(deliveryExecutionDestinationInternals.deliveryEvidenceBytesMatch(
      "application/pdf",
      Buffer.from("not a pdf"),
      digest,
    )).toBe(false);
    expect(deliveryExecutionDestinationInternals.deliveryEvidenceBytesMatch(
      "image/jpeg",
      bytes,
      digest,
    )).toBe(false);
    expect(deliveryExecutionDestinationInternals.deliveryEvidenceBytesMatch(
      "application/pdf",
      bytes,
      "0".repeat(64),
    )).toBe(false);
  });
});
