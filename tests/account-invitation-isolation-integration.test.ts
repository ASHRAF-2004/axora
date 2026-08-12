import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFile(
  new URL(`../${path}`, import.meta.url),
  "utf8",
);

describe("account invitation isolation integration", () => {
  it("reauthorizes creation after the audited transaction begins", async () => {
    const accountSetup = await source("src/lib/account-setup.ts");
    const transaction = accountSetup.indexOf("withAuditTransaction(");
    const creationLock = accountSetup.indexOf(
      "lockAuthorizedInvitationCreationScope(client, actor, resolved)",
    );
    const userInsert = accountSetup.indexOf("createScopedUserInTransaction(");
    expect(transaction).toBeGreaterThanOrEqual(0);
    expect(creationLock).toBeGreaterThan(transaction);
    expect(userInsert).toBeGreaterThan(creationLock);
  });

  it("locks invitation replacement inside the same transaction", async () => {
    const accountSetup = await source("src/lib/account-setup.ts");
    const resend = accountSetup.indexOf(
      "export async function resendAccountSetupInvitation",
    );
    const transaction = accountSetup.indexOf("withAuditTransaction(", resend);
    const targetLock = accountSetup.indexOf(
      "lockAuthorizedInvitationResendTarget(",
      resend,
    );
    const revoke = accountSetup.indexOf(
      "UPDATE account_setup_invitations",
      targetLock,
    );
    expect(resend).toBeGreaterThanOrEqual(0);
    expect(transaction).toBeGreaterThan(resend);
    expect(targetLock).toBeGreaterThan(transaction);
    expect(revoke).toBeGreaterThan(targetLock);
  });

  it("does not rely on a pre-transaction user lock in the server action", async () => {
    const actions = await source("src/app/(portal)/users/actions.ts");
    expect(actions).not.toContain("lockAuthorizedUserTarget(");
    expect(actions).toContain(
      "resendAccountSetupInvitation(parsedUserId.data, actor)",
    );
  });
});
