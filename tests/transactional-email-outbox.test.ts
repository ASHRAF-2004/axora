import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    withAuditTransaction: vi.fn(
      async (_context: unknown, work: (client: typeof mocks.client) => unknown) =>
        work(mocks.client),
    ),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  withAuditTransaction: mocks.withAuditTransaction,
}));

import {
  claimTransactionalEmailOutbox,
  completeTransactionalEmailOutbox,
  prepareSecurityEmailOutbox,
} from "@/lib/transactional-email";
import { hashSecurityToken } from "@/lib/security-notifications";

const sourceId = "00000000-0000-4000-8000-000000000001";
const outboxId = "00000000-0000-4000-8000-000000000002";
const rawToken = "C".repeat(43);

describe("generic transactional email outbox", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.APP_BASE_URL = "https://axora.management";
    process.env.AXORA_CONTACT_NOTIFICATION_TO = "monitored-inbox@example.test";
    process.env.AXORA_EMAIL_SERVICE_AUTH_KEY =
      "test-only-transactional-email-key-abcdefghijklmnopqrstuvwxyz";
  });

  it("decrypts a reset token only after a locked claim and builds a fragment URL", async () => {
    const tokenHash = hashSecurityToken(rawToken);
    const encrypted = prepareSecurityEmailOutbox({
      rawToken,
      tokenHash,
      sourceId,
      outboxId,
      messageKind: "PASSWORD_RESET",
      locale: "en",
    });
    mocks.client.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        deliveryId: outboxId,
        messageKind: "PASSWORD_RESET",
        locale: "en",
        sourceId,
        tokenHash,
        tokenCiphertext: encrypted.tokenCiphertext,
        tokenNonce: encrypted.tokenNonce,
        tokenAuthenticationTag: encrypted.tokenAuthenticationTag,
        recipientName: "Aisha Rahman",
        recipientEmail: "aisha@example.test",
        expiresAt: "2026-08-03T06:00:00.000Z",
      }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: outboxId }] });

    const job = await claimTransactionalEmailOutbox();
    expect(job).toMatchObject({
      deliveryId: outboxId,
      messageKind: "PASSWORD_RESET",
      recipientEmail: "aisha@example.test",
    });
    expect(job?.actionUrl).toContain("/account/reset-password#token=");
    expect(job?.actionUrl).toContain(rawToken);
    expect(new URL(String(job?.actionUrl)).search).toBe("");
    expect(String(mocks.client.query.mock.calls[0][0])).toContain(
      "recipient_suppressed",
    );
    expect(String(mocks.client.query.mock.calls[0][0])).toContain(
      "axora_email_recipient_is_suppressed",
    );
    expect(String(mocks.client.query.mock.calls[0][0])).not.toContain(
      "email_recipient_suppressions",
    );
    expect(String(mocks.client.query.mock.calls[3][0])).toContain(
      "axora_email_recipient_is_suppressed",
    );
    expect(String(mocks.client.query.mock.calls[3][0])).toContain(
      "FOR UPDATE OF outbox SKIP LOCKED",
    );
    expect(JSON.stringify(mocks.client.query.mock.calls)).not.toContain(rawToken);
  });

  it("resolves the monitored contact recipient only at claim time", async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        deliveryId: outboxId,
        messageKind: "CONTACT_NOTIFICATION",
        locale: "en",
        contactName: "Aisha Rahman",
        contactEmail: "aisha@example.test",
        companyName: "Example Industries",
        phone: "+60 12 345 6789",
        subject: "Procurement workflow",
        message: "A private contact message for the Axora team.",
        submittedAt: "2026-08-03T06:00:00.000Z",
      }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: outboxId }] });

    const job = await claimTransactionalEmailOutbox();
    expect(job).toMatchObject({
      messageKind: "CONTACT_NOTIFICATION",
      recipientEmail: "monitored-inbox@example.test",
      replyToEmail: "aisha@example.test",
      contact: { company: "Example Industries" },
    });
    const selectedValues = mocks.client.query.mock.calls[3][1];
    expect(selectedValues[0]).toBe("monitored-inbox@example.test");
    expect(mocks.client.query.mock.calls[0][1]).toEqual([
      "monitored-inbox@example.test",
    ]);
  });

  it("claims a visitor acknowledgement to the submitted address", async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        deliveryId: outboxId,
        messageKind: "CONTACT_ACKNOWLEDGEMENT",
        locale: "ar",
        contactName: "Aisha Rahman",
        contactEmail: "aisha@example.test",
        companyName: "Example Industries",
        subject: "Procurement workflow",
        message: "A private contact message for the Axora team.",
        submittedAt: "2026-08-03T06:00:00.000Z",
      }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: outboxId }] });

    const job = await claimTransactionalEmailOutbox();
    expect(job).toMatchObject({
      messageKind: "CONTACT_ACKNOWLEDGEMENT",
      locale: "ar",
      recipientEmail: "aisha@example.test",
      recipientName: "Aisha Rahman",
      contact: { company: "Example Industries" },
    });
    expect(job?.replyToEmail).toBeUndefined();
    expect(String(mocks.client.query.mock.calls[3][0])).toContain(
      "submission.acknowledgement_status='QUEUED'",
    );
  });

  it("claims a tokenless password-change confirmation after reset completion", async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        deliveryId: outboxId,
        messageKind: "PASSWORD_CHANGED",
        locale: "ms",
        recipientName: "Aisha Rahman",
        recipientEmail: "aisha@example.test",
      }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: outboxId }] });
    const job = await claimTransactionalEmailOutbox();
    expect(job).toEqual(expect.objectContaining({
      messageKind: "PASSWORD_CHANGED",
      locale: "ms",
      recipientEmail: "aisha@example.test",
    }));
    expect(job?.actionUrl).toBeUndefined();
  });

  it("updates contact lifecycle only after a final leased outcome", async () => {
    const leaseId = "00000000-0000-4000-8000-000000000003";
    mocks.client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        contactSubmissionId: sourceId,
        deliveryStatus: "SENT",
      }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await expect(completeTransactionalEmailOutbox(
      outboxId,
      leaseId,
      "sent",
      { providerMessageId: "provider-message-1" },
    )).resolves.toBe(true);
    const contactUpdate = mocks.client.query.mock.calls[1];
    expect(String(contactUpdate[0])).toContain("UPDATE public_contact_submissions");
    expect(contactUpdate[1]).toEqual([sourceId, "NOTIFIED"]);

    vi.clearAllMocks();
    mocks.client.query.mockResolvedValueOnce({ rowCount: 1, rows: [{
      contactSubmissionId: sourceId,
      deliveryStatus: "PENDING",
    }] });
    await expect(completeTransactionalEmailOutbox(
      outboxId,
      leaseId,
      "retry",
      { errorCode: "provider_rate_limited" },
    )).resolves.toBe(true);
    expect(mocks.client.query).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    mocks.client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{
        contactSubmissionId: sourceId,
        deliveryStatus: "FAILED",
        messageKind: "CONTACT_ACKNOWLEDGEMENT",
      }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    await expect(completeTransactionalEmailOutbox(
      outboxId,
      leaseId,
      "failed",
      { errorCode: "provider_unavailable" },
    )).resolves.toBe(true);
    expect(String(mocks.client.query.mock.calls[1][0])).toContain(
      "acknowledgement_status=$2",
    );
    expect(mocks.client.query.mock.calls[1][1]).toEqual([sourceId, "FAILED"]);
  });

  it("leaves contact work unclaimed until a private monitored inbox is configured", async () => {
    delete process.env.AXORA_CONTACT_NOTIFICATION_TO;
    mocks.client.query
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(claimTransactionalEmailOutbox()).resolves.toBeNull();
    expect(mocks.client.query.mock.calls[3][1][0]).toBeNull();
  });
});
