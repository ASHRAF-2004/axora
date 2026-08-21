import { recordPublicContactSubmission } from "@/lib/company-leads";
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

const submissionId = "52000000-0000-4000-8000-000000000002";

function clientWithSnapshots(...snapshots: unknown[]) {
  const query = vi.fn();
  for (const snapshot of snapshots) {
    query.mockResolvedValueOnce({ rows: [{ snapshot }] });
  }
  return { client: { query } as unknown as PoolClient, query };
}

describe("public contact submission persistence", () => {
  it("uses the enquiry-only database contract and queues the support notification", async () => {
    const { client, query } = clientWithSnapshots({ created: true, submissionId });
    query.mockResolvedValueOnce({ rows: [{ id: "outbox-id" }] });

    const result = await recordPublicContactSubmission(
      client,
      { idempotencyKey: "fingerprint", contactName: "Aisha Rahman" },
      "en",
      new Date("2026-08-20T01:00:00.000Z"),
    );

    expect(result).toEqual({ created: true, submissionId });
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain("axora_record_public_contact_submission");
    expect(query.mock.calls[1]?.[0]).toContain("CONTACT_NOTIFICATION");
    expect(query.mock.calls[1]?.[0]).not.toContain("CONTACT_ACKNOWLEDGEMENT");
  });

  it("does not enqueue a second email for an idempotent replay", async () => {
    const { client, query } = clientWithSnapshots({ created: false, submissionId });

    const result = await recordPublicContactSubmission(
      client,
      { idempotencyKey: "fingerprint" },
      "ms",
      new Date("2026-08-20T01:00:00.000Z"),
    );

    expect(result).toEqual({ created: false, submissionId });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
