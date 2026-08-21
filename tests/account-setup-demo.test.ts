import { beforeEach, describe, expect, it } from "vitest";

import {
  createInvitedUser,
  recordAccountSetupDelivery,
} from "@/lib/account-setup";
import type { SessionUser } from "@/lib/auth";
import { getDemoStore } from "@/lib/demo-data";
import { listUsers } from "@/lib/users";

const owner: SessionUser = {
  id: "90000000-0000-4000-8000-000000000009",
  email: "owner@axora.invalid",
  name: "Owner fixture",
  role: "PLATFORM_OWNER",
  accountKind: "PLATFORM",
  scopeType: "PLATFORM",
  isOwner: true,
};

describe("demo account invitation parity", () => {
  beforeEach(() => {
    process.env.DEMO_MODE = "true";
    global.__axoraDemoUsers = undefined;
    global.__axoraDemoAccountSetupInvitations = undefined;
  });

  it("creates an invitation-backed scoped company user without persisting its raw token", async () => {
    const company = getDemoStore().companies[0]!;
    const invitation = await createInvitedUser({
      email: "new-company-admin@axora.invalid",
      displayName: "New company admin",
      role: "COMPANY_ADMIN",
      companyId: company.id,
      preferredLocale: "ms",
    }, owner);

    expect(invitation).toMatchObject({
      companyName: company.name,
      role: "COMPANY_ADMIN",
      locale: "ms",
    });
    expect(invitation.rawToken).toHaveLength(43);
    const storedInvitation = global.__axoraDemoAccountSetupInvitations?.get(
      invitation.invitationId,
    );
    expect(storedInvitation).not.toHaveProperty("rawToken");
    expect(storedInvitation?.tokenHash).toMatch(/^[a-f0-9]{64}$/);

    expect(await recordAccountSetupDelivery(invitation.invitationId, {
      succeeded: false,
      status: "disabled",
    })).toBe(true);
    expect((await listUsers(owner)).find((user) => user.id === invitation.userId))
      .toMatchObject({
        accountKind: "COMPANY",
        accountStatus: "INVITED",
        accountSetupDeliveryStatus: "DISABLED",
        companyId: company.id,
        scopeType: "COMPANY",
      });
  });

  it("fails closed for an unknown company and duplicate email", async () => {
    const input = {
      email: "unique-company-admin@axora.invalid",
      displayName: "Unique company admin",
      role: "COMPANY_ADMIN",
      companyId: getDemoStore().companies[0]!.id,
    } as const;
    await createInvitedUser(input, owner);
    await expect(createInvitedUser(input, owner)).rejects.toThrow(/already uses/i);
    await expect(createInvitedUser({
      ...input,
      email: "unknown-company@axora.invalid",
      companyId: "99999999-9999-4999-8999-999999999999",
    }, owner)).rejects.toThrow(/company is unavailable/i);
  });
});
