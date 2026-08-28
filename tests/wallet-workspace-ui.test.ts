import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Company Wallet and Approve & Pay application boundaries", () => {
  it("has a purpose-specific, URL-addressable wallet workspace", async () => {
    const [page, detail, actions, navigation] = await Promise.all([
      readFile(new URL("../src/app/(portal)/wallet/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(portal)/wallet/WalletDetail.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(portal)/wallet/actions.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/lib/portal-navigation.ts", import.meta.url), "utf8"),
    ]);
    expect(page).toContain('requirePagePermission("view_wallet")');
    expect(page).toContain("loadCompanyLifecycleWorkspace(actor)");
    expect(page).toContain("/companies/${encodeURIComponent(company.id)}/wallet");
    expect(page).not.toContain("workspace.wallets[0]");
    expect(detail).toContain('name="commandId"');
    expect(actions).toContain('requirePermission("request_wallet_top_up")');
    expect(actions).toContain('requirePermission("record_wallet_top_up")');
    expect(navigation).toContain('href: "/wallet"');
  });

  it("removes requester checkout and uses only the atomic SQL command", async () => {
    const [checkout, requestActions, requestDetail, approvalActions, walletService] = await Promise.all([
      readFile(new URL("../src/lib/payment-checkout.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(portal)/requests/actions.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(portal)/requests/[id]/page.tsx", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(portal)/approvals/actions.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/lib/company-wallet.ts", import.meta.url), "utf8"),
    ]);
    expect(checkout).not.toContain("axora_complete_payment");
    expect(requestActions).not.toContain("payRequestAction");
    expect(requestActions).toContain("financeState");
    expect(requestDetail).toContain("approveAndPayResultCopy(locale, financeResult, financeState)");
    expect(approvalActions).toContain("approveAndPay(actor");
    expect(walletService).toContain("axora_approve_and_pay");
  });

  it("never parses authoritative wallet form amounts through Number", async () => {
    const [walletService, walletActions] = await Promise.all([
      readFile(new URL("../src/lib/company-wallet.ts", import.meta.url), "utf8"),
      readFile(new URL("../src/app/(portal)/wallet/actions.ts", import.meta.url), "utf8"),
    ]);
    expect(walletService).not.toMatch(/Number\(.*amount/i);
    expect(walletActions).not.toMatch(/Number\(/);
  });
});
