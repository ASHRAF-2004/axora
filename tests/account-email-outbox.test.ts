import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const client = { query: vi.fn() };
  return {
    client,
    query: vi.fn(),
    appendWorkflowEvent: vi.fn(),
    notifyWorkflowUsers: vi.fn(),
    withAuditTransaction: vi.fn(
      async (_context: unknown, work: (client: typeof mocks.client) => unknown) =>
        work(mocks.client),
    ),
  };
});

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  query: mocks.query,
  withAuditTransaction: mocks.withAuditTransaction,
}));

vi.mock("@/lib/workflow-repository", () => ({
  appendWorkflowEvent: mocks.appendWorkflowEvent,
  notifyWorkflowUsers: mocks.notifyWorkflowUsers,
}));

import {
  authorizeAccountSetupDelivery,
  hashAccountSetupToken,
  recordAccountSetupDelivery,
} from "@/lib/account-setup";

const invitationId = "00000000-0000-4000-8000-000000000001";
const rawToken = "A".repeat(43);

describe("one-shot account setup email delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendWorkflowEvent.mockResolvedValue({ created: true });
  });

  it("authorizes from the persisted digest without sending the raw token to PostgreSQL", async () => {
    mocks.client.query.mockResolvedValue({ rowCount: 1, rows: [{ id: invitationId }] });

    await expect(authorizeAccountSetupDelivery(invitationId, rawToken))
      .resolves.toBe(true);

    const [sql, values] = mocks.client.query.mock.calls[0];
    expect(String(sql)).toContain("SET delivery_status='SENDING'");
    expect(String(sql)).toContain("invitation.token_hash=$2");
    expect(String(sql)).toContain("invitation.delivery_status='PENDING'");
    expect(String(sql)).toContain("invitation.delivery_attempt_count=0");
    expect(String(sql)).toContain("axora_email_recipient_is_suppressed");
    expect(values).toEqual([invitationId, hashAccountSetupToken(rawToken)]);
    expect(String(sql)).not.toMatch(/lease|ciphertext|token_nonce|authentication_tag/i);
    expect(JSON.stringify(mocks.client.query.mock.calls)).not.toContain(rawToken);
  });

  it("records exactly one synchronous successful attempt without an outbox lease", async () => {
    mocks.client.query.mockResolvedValue({ rowCount: 1, rows: [{ id: invitationId }] });

    await expect(recordAccountSetupDelivery(invitationId, {
      succeeded: true,
      providerMessageId: "provider-message-123",
      providerName: "resend",
      status: "sent",
    })).resolves.toBe(true);

    const [sql, values] = mocks.client.query.mock.calls[0];
    expect(String(sql)).toContain("delivery_attempt_count=1");
    expect(String(sql)).toContain("delivery_status IN ('PENDING','SENDING')");
    expect(String(sql)).not.toMatch(/lease|ciphertext|token_nonce|authentication_tag/i);
    expect(values).toEqual([
      invitationId,
      "SENT",
      true,
      "provider-message-123",
      "resend",
    ]);
  });

  it("stores a final failure instead of returning the same token to a retry queue", async () => {
    mocks.client.query.mockResolvedValue({ rowCount: 1, rows: [{ id: invitationId }] });

    await expect(recordAccountSetupDelivery(invitationId, {
      succeeded: false,
      status: "failed",
    })).resolves.toBe(true);

    const [sql, values] = mocks.client.query.mock.calls[0];
    expect(String(sql)).toContain("delivery_status=$2");
    expect(String(sql)).not.toContain("'PENDING',delivery");
    expect(values).toContain("FAILED");
  });

  it("records company invitation workflow evidence only after confirmed delivery", async () => {
    const companyId = "10000000-0000-4000-8000-000000000001";
    const issuerId = "90000000-0000-4000-8000-000000000001";
    mocks.client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: invitationId }] })
      .mockResolvedValueOnce({ rows: [{
        companyId,
        createdBy: issuerId,
        creatorRole: "PLATFORM_OWNER",
        creatorAccountKind: "PLATFORM",
        creatorIsOwner: true,
      }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await expect(recordAccountSetupDelivery(invitationId, {
      succeeded: true,
      providerMessageId: "provider-message-456",
      status: "sent",
    })).resolves.toBe(true);

    expect(mocks.appendWorkflowEvent).toHaveBeenCalledWith(mocks.client, {
      companyId,
      aggregateType: "account-invitation",
      aggregateId: invitationId,
      eventKey: "invitation.sent",
      stableKey: "provider-confirmed",
      actor: {
        id: issuerId,
        role: "PLATFORM_OWNER",
        accountKind: "PLATFORM",
        isOwner: true,
        companyId: undefined,
        branchId: undefined,
      },
      newState: "SENT",
      source: "SYSTEM",
    });
    const [contextSql] = mocks.client.query.mock.calls[1];
    expect(String(contextSql)).toContain(
      'creator_role.role_key AS "creatorRole"',
    );
    expect(String(contextSql)).toContain(
      "JOIN roles creator_role ON creator_role.id=creator.role_id",
    );
    expect(String(contextSql)).not.toContain(
      'creator.role AS "creatorRole"',
    );
    expect(mocks.client.query).toHaveBeenNthCalledWith(
      3,
      "SELECT set_config('axora.user_id',$1,true)",
      [issuerId],
    );
    expect(JSON.stringify(mocks.appendWorkflowEvent.mock.calls))
      .not.toMatch(/provider-message-456|example\.test|A{20}/);
  });

  it("does not invent a tenant workflow event for scope-less invitations", async () => {
    mocks.client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: invitationId }] })
      .mockResolvedValueOnce({ rows: [{
        createdBy: "90000000-0000-4000-8000-000000000009",
        creatorRole: "PLATFORM_OWNER",
        creatorAccountKind: "PLATFORM",
        creatorIsOwner: true,
      }] });

    await expect(recordAccountSetupDelivery(invitationId, {
      succeeded: true,
      status: "sent",
    })).resolves.toBe(true);
    expect(mocks.appendWorkflowEvent).not.toHaveBeenCalled();
  });
});

describe("hash-only account invitation architecture guard", () => {
  const accountSetupSource = readFileSync(
    new URL("../src/lib/account-setup.ts", import.meta.url),
    "utf8",
  );
  const accountEmailSource = readFileSync(
    new URL("../src/lib/account-email.ts", import.meta.url),
    "utf8",
  );
  const invitationMigration = readFileSync(
    new URL("../database/migrations/014_account_setup_invitations.sql", import.meta.url),
    "utf8",
  );
  const transactionalSource = readFileSync(
    new URL("../src/lib/transactional-email.ts", import.meta.url),
    "utf8",
  );
  const bootstrapSource = readFileSync(
    new URL("../scripts/bootstrap/create_first_platform_owner.mjs", import.meta.url),
    "utf8",
  );
  const senderSource = readFileSync(
    new URL("../server-tools/email-sender.mjs", import.meta.url),
    "utf8",
  );

  it("has no recoverable account-setup token payload, lease, or polling API", () => {
    for (const source of [accountSetupSource, invitationMigration]) {
      expect(source).not.toMatch(/token_ciphertext|token_nonce|token_authentication_tag/i);
      expect(source).not.toMatch(/delivery_lease|delivery_available_at/i);
    }
    expect(accountSetupSource).not.toMatch(
      /claimAccountSetupEmailOutbox|completeAccountSetupEmailOutbox|encryptAccountSetupToken/,
    );
    expect(accountEmailSource).toContain("authorizeAccountSetupDelivery");
    expect(accountEmailSource).not.toMatch(/claimAccountSetupEmailOutbox|leaseId/);
    expect(bootstrapSource).not.toMatch(
      /prepareEncryptedSetupToken|token_ciphertext|token_nonce|token_authentication_tag/,
    );
    expect(senderSource).not.toContain("pollAccountEmailOutboxOnce");
  });

  it("retains encrypted durable delivery only for reset and verification mail", () => {
    expect(transactionalSource).toContain("token_ciphertext");
    expect(transactionalSource).toContain("claimTransactionalEmailOutbox");
    expect(transactionalSource).toContain("completeTransactionalEmailOutbox");
    expect(senderSource).toContain("pollTransactionalEmailOutboxOnce");
  });
});
