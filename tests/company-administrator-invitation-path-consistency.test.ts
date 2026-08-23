import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

describe("Company Administrator invitation entry-point consistency", () => {
  it("routes both retained entry points through the same post-delivery service", async () => {
    const [usersAction, mastersAction] = await Promise.all([
      source("src/app/(portal)/users/actions.ts"),
      source("src/app/(portal)/masters/actions.ts"),
    ]);

    for (const action of [usersAction, mastersAction]) {
      expect(action).toContain("deliverAccountSetupInvitation(invitation, actor)");
      expect(action).not.toContain("sendAccountSetupEmail(invitation)");
      expect(action).not.toContain("recordAccountSetupDelivery(invitation.invitationId");
    }
    expect(usersAction).toContain("export async function createCompanyUserAction");
    expect(mastersAction).toContain("export async function inviteCompanyAdministratorAction");
  });
});
