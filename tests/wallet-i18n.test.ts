import { describe, expect, it } from "vitest";
import { SUPPORTED_LOCALES } from "@/lib/i18n";
import {
  APPROVE_AND_PAY_RESULT_STATUSES,
  TOP_UP_STATUSES,
  isApproveAndPayLocalNotReadyState,
  isApproveAndPayResultStatus,
  isTopUpStatus,
} from "@/lib/finance-business-results";
import {
  APPROVE_AND_PAY_RESULT_TONES,
  approveAndPayResultCopy,
  topUpStatusLabel,
  walletMessages,
} from "@/lib/wallet-i18n";

describe("wallet and Approve & Pay localization", () => {
  it("keeps the SQL business-result status contract exact", () => {
    expect(APPROVE_AND_PAY_RESULT_STATUSES).toEqual([
      "SUCCESS",
      "ALREADY_PROCESSED",
      "INSUFFICIENT_WALLET",
      "INSUFFICIENT_BUDGET",
      "STALE_REQUEST",
      "NOT_READY",
    ]);
    expect(isApproveAndPayResultStatus("SUCCESS")).toBe(true);
    expect(isApproveAndPayResultStatus("PAID")).toBe(false);
    expect(isApproveAndPayResultStatus(null)).toBe(false);
    expect(isApproveAndPayLocalNotReadyState("BRANCH_LOCATION_REQUIRED")).toBe(true);
    expect(isApproveAndPayLocalNotReadyState("ARBITRARY_STATE")).toBe(false);
  });

  it("provides complete, non-empty result copy in English, Arabic, and Malay", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const status of APPROVE_AND_PAY_RESULT_STATUSES) {
        const copy = approveAndPayResultCopy(locale, status);
        expect(copy.title.trim(), `${locale}:${status}:title`).not.toBe("");
        expect(copy.body.trim(), `${locale}:${status}:body`).not.toBe("");
        expect(APPROVE_AND_PAY_RESULT_TONES[status]).toMatch(/^(success|information|warning)$/);
      }
    }
  });

  it("uses a local insufficient-balance message instead of a generic error", () => {
    expect(approveAndPayResultCopy("en", "INSUFFICIENT_WALLET").body).toBe(
      "Company balance is insufficient. Contact your Company Administrator to arrange a top-up.",
    );
    expect(approveAndPayResultCopy("ar", "INSUFFICIENT_WALLET").body).toContain("رصيد الشركة");
    expect(approveAndPayResultCopy("ms", "INSUFFICIENT_WALLET").body).toContain("Baki syarikat");
  });

  it("maps the locked delivery-location guard to local business copy", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const copy = approveAndPayResultCopy(
        locale,
        "NOT_READY",
        "BRANCH_LOCATION_REQUIRED",
      );
      expect(copy.title.trim()).not.toBe("");
      expect(copy.body).toMatch(/location|موقع|lokasi/i);
    }
    expect(approveAndPayResultCopy(
      "en",
      "NOT_READY",
      "BRANCH_LOCATION_REQUIRED",
    ).body).toContain("No approval or funds were recorded");
  });

  it("provides wallet, top-up, and status language for every locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      const copy = walletMessages(locale);
      expect(copy.companyWallet.trim()).not.toBe("");
      expect(copy.requestTopUp.trim()).not.toBe("");
      expect(copy.recordTopUp.trim()).not.toBe("");
      expect(copy.approveAndPay.trim()).not.toBe("");
      for (const status of TOP_UP_STATUSES) {
        expect(topUpStatusLabel(locale, status).trim(), `${locale}:${status}`).not.toBe("");
      }
    }
    expect(isTopUpStatus("RECEIVED")).toBe(true);
    expect(isTopUpStatus("RECORDED")).toBe(false);
  });

  it("explains that requesting a top-up does not credit funds", () => {
    expect(walletMessages("en").requestTopUpIntro).toContain("does not credit funds");
    expect(walletMessages("ar").requestTopUpIntro).toContain("لا يضيف");
    expect(walletMessages("ms").requestTopUpIntro).toContain("tidak mengkreditkan");
  });
});
