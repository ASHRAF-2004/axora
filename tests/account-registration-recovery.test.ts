import { PGlite, type Transaction } from "@electric-sql/pglite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyMigrations } from "./helpers/pglite";
import type { AuthenticatedSessionUser } from "@/lib/auth";

const runtime = vi.hoisted(() => ({ db: undefined as PGlite | undefined }));
const previousDeliveryEnabled = process.env.AXORA_EMAIL_DELIVERY_ENABLED;

async function queryResult(db: PGlite | Transaction, sql: string, values: unknown[] = []) {
  const result = await db.query(sql, values);
  return { ...result, rowCount: Math.max(result.affectedRows ?? 0, result.rows.length) };
}

vi.mock("@/lib/db", () => ({
  isDemoMode: () => false,
  query: (sql: string, values: unknown[]) => queryResult(runtime.db!, sql, values),
  withAuditTransaction: (
    context: { actor?: { id: string; roleAssignmentId?: string }; reason?: string },
    work: (client: {
      query: (sql: string, values?: unknown[]) => ReturnType<typeof queryResult>;
    }) => unknown,
  ) => runtime.db!.transaction(async (tx) => {
    await tx.query(`SELECT set_config('axora.user_id',$1,true),
      set_config('axora.role_assignment_id',$2,true),
      set_config('axora.change_reason',$3,true)`, [
      context.actor?.id ?? "", context.actor?.roleAssignmentId ?? "", context.reason ?? "",
    ]);
    await tx.exec("SET LOCAL ROLE axora_app");
    return work({ query: (sql, values) => queryResult(tx, sql, values) });
  }),
}));

import {
  authorizeAccountSetupDelivery, consumeAccountSetupToken, createInvitedUser,
  inspectAccountSetupToken, recordAccountSetupDelivery,
} from "@/lib/account-setup";
import { deliverAccountSetupInvitation } from "@/lib/account-invitation-delivery";
import { accountSetupInvitationReplacementBlocker } from "@/lib/account-invitation-eligibility";

const owner: AuthenticatedSessionUser = {
  id: "db000000-0000-4000-8000-000000000001",
  email: "owner-registration-fixture@example.test",
  name: "Registration fixture Owner",
  role: "PLATFORM_OWNER", accountKind: "PLATFORM", scopeType: "PLATFORM",
  roleAssignmentId: "db000000-0000-4000-8000-000000000002",
  isOwner: true, authVersion: 1,
};

async function fixture() {
  const db = new PGlite();
  runtime.db = db;
  await db.exec("CREATE ROLE axora_app NOLOGIN");
  await applyMigrations(db);
  await db.query(`INSERT INTO users(
    id,email,display_name,password_hash,role_id,is_owner,account_kind,
    account_status,active,account_setup_completed_at
  ) VALUES ($1,$2,$3,'not-a-real-hash',
    (SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),
    true,'PLATFORM','ACTIVE',true,now())`, [owner.id, owner.email, owner.name]);
  await db.query(`INSERT INTO role_assignments(
    id,user_id,role_id,scope_type,active,assigned_by
  ) VALUES ($1,$2,(SELECT id FROM roles WHERE role_key='PLATFORM_OWNER'),
    'PLATFORM',true,$2)`, [owner.roleAssignmentId, owner.id]);
  return db;
}

afterEach(async () => {
  await runtime.db?.close();
  runtime.db = undefined;
  if (previousDeliveryEnabled === undefined) delete process.env.AXORA_EMAIL_DELIVERY_ENABLED;
  else process.env.AXORA_EMAIL_DELIVERY_ENABLED = previousDeliveryEnabled;
  vi.restoreAllMocks();
});

describe("registration recovery at the account invitation database boundary", () => {
  it("records an unsuccessful pre-send claim as a replaceable terminal invitation", async () => {
    const db = await fixture();
    const invitation = await createInvitedUser({
      email: "registration-recovery@example.test", displayName: "Recovery fixture",
      role: "HUMAN_RESOURCES_MANAGEMENT", preferredLocale: "en",
    }, owner);
    // Exercise the actual refused claim before any private sender/provider call.
    process.env.AXORA_EMAIL_DELIVERY_ENABLED = "true";
    await db.query(`UPDATE email_agent_controls SET paused=true,
      pause_reason='Isolated account registration recovery fixture',changed_by=$1
      WHERE provider_agent='axora-auth'`, [owner.id]);
    const providerCall = vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("No external email is permitted in this fixture"),
    );
    await expect(deliverAccountSetupInvitation(invitation, owner)).resolves.toBe("failed");
    const result = await db.query<{
      deliveryStatus: "CANCELLED"; expiresAt: Date; attempts: number;
      providerMessageId: string | null; credentials: number; users: number;
    }>(`SELECT delivery_status AS "deliveryStatus",expires_at AS "expiresAt",
      delivery_attempt_count AS attempts,provider_message_id AS "providerMessageId",
      (SELECT count(*)::int FROM users WHERE id=$2) AS users,
      (SELECT count(*)::int FROM account_credentials
        WHERE user_id=$2 AND password_hash IS NULL) AS credentials
      FROM account_setup_invitations WHERE id=$1`, [invitation.invitationId, invitation.userId]);
    expect(result.rows[0]).toMatchObject({
      deliveryStatus: "CANCELLED", attempts: 1, providerMessageId: null,
      users: 1, credentials: 1,
    });
    expect(accountSetupInvitationReplacementBlocker({
      currentInvitationPresent: true, deliveryStatus: result.rows[0].deliveryStatus,
      expiresAt: result.rows[0].expiresAt,
    })).toBeUndefined();
    await expect(recordAccountSetupDelivery(invitation.invitationId, {
      succeeded: false, status: "failed",
    })).resolves.toBe(true);
    await expect(inspectAccountSetupToken(invitation.rawToken))
      .resolves.toEqual({ valid: false, reason: "invalid" });
    expect(providerCall).not.toHaveBeenCalled();
  }, 30_000);

  it("rejects an unclaimed provider success and keeps the account inactive", async () => {
    const db = await fixture();
    const invitation = await createInvitedUser({
      email: "registration-unclaimed@example.test", displayName: "Unclaimed fixture",
      role: "HUMAN_RESOURCES_MANAGEMENT", preferredLocale: "en",
    }, owner);
    await expect(recordAccountSetupDelivery(invitation.invitationId, {
      succeeded: true, status: "sent", providerMessageId: "isolated-provider-fixture",
    })).rejects.toMatchObject({ code: "P0001" });
    const result = await db.query<{ status: string; completed: boolean }>(`
      SELECT account.account_status AS status,
        account.account_setup_completed_at IS NOT NULL AS completed
      FROM users account WHERE id=$1`, [invitation.userId]);
    expect(result.rows[0]).toEqual({ status: "INVITED", completed: false });
  }, 30_000);

  it("completes the claimed invitation once and preserves duplicate identity protection", async () => {
    const db = await fixture();
    const input = {
      email: "registration-valid@example.test", displayName: "Valid registration fixture",
      role: "HUMAN_RESOURCES_MANAGEMENT" as const, preferredLocale: "ms" as const,
    };
    const invitation = await createInvitedUser(input, owner);
    await expect(createInvitedUser({ ...input, email: input.email.toUpperCase() }, owner))
      .rejects.toMatchObject({ name: "UserCreationError", reason: "invitation-pending" });
    await expect(authorizeAccountSetupDelivery(invitation.invitationId, invitation.rawToken))
      .resolves.toBe(true);
    await expect(recordAccountSetupDelivery(invitation.invitationId, {
      succeeded: true, status: "sent", providerMessageId: "isolated-provider-fixture",
      providerName: "resend",
    })).resolves.toBe(true);
    await expect(inspectAccountSetupToken(invitation.rawToken)).resolves.toMatchObject({
      valid: true, role: input.role, locale: "ms",
    });
    const activation = {
      displayName: input.displayName, locale: "ms" as const,
      termsAccepted: true as const, privacyAccepted: true as const,
    };
    await expect(consumeAccountSetupToken(
      invitation.rawToken, "isolated account setup passphrase", activation,
    )).resolves.toMatchObject({
      id: invitation.userId, role: input.role, authVersion: 2,
    });
    await expect(consumeAccountSetupToken(
      invitation.rawToken, "isolated account setup passphrase", activation,
    )).rejects.toMatchObject({ name: "AccountSetupTokenError", reason: "used" });
    const result = await db.query<{ users: number; invitations: number; active: number }>(`
      SELECT (SELECT count(*)::int FROM users WHERE lower(email)=lower($1)) AS users,
        (SELECT count(*)::int FROM account_setup_invitations WHERE user_id=$2) AS invitations,
        (SELECT count(*)::int FROM users WHERE id=$2 AND account_status='ACTIVE'
          AND account_setup_completed_at IS NOT NULL) AS active`, [input.email, invitation.userId]);
    expect(result.rows[0]).toEqual({ users: 1, invitations: 1, active: 1 });
  }, 30_000);
});
