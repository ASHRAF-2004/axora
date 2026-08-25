import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserSessionScope } from "@/lib/browser-session-scope";
import { clearDeliveryBrowserState } from "@/lib/delivery-browser-state";
import {
  clearRequestCart,
  readRequestCart,
  requestCartStorageKey,
  writeRequestCart,
} from "@/lib/request-cart";
import {
  clearRequestDraft,
  newRequestSubmissionKey,
  readRequestDraft,
  requestDraftInternals,
  writeRequestDraft,
} from "@/lib/request-draft";

class MemoryStorage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

const scopeA: BrowserSessionScope = {
  userId: "10000000-0000-4000-8000-000000000050",
  companyId: "20000000-0000-4000-8000-000000000050",
};
const scopeB: BrowserSessionScope = {
  userId: "30000000-0000-4000-8000-000000000050",
  companyId: scopeA.companyId,
};
const scopeC: BrowserSessionScope = {
  userId: scopeA.userId,
  companyId: "40000000-0000-4000-8000-000000000050",
};

const cart = [{
  product: {
    id: "50000000-0000-4000-8000-000000000050",
    publicRef: "AX-REF-500000000050",
    code: "P-050",
    name: "A4 Paper",
    category: "Office",
    subcategory: "Paper",
    unit: "Ream",
    defaultSellPrice: 14,
    minimumOrderQuantity: 1,
    deliverySlaDays: 2,
    hasImage: false,
  },
  quantity: 3,
  specification: "80 gsm",
}];

describe("browser session state isolation", () => {
  let localStorage: MemoryStorage;

  beforeEach(() => {
    localStorage = new MemoryStorage();
    vi.stubGlobal("window", {
      localStorage,
      sessionStorage: new MemoryStorage(),
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal("CustomEvent", class CustomEvent<T> {
      detail: T;
      constructor(_name: string, init?: { detail?: T }) {
        this.detail = init?.detail as T;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps cart contents separate by both user and company", () => {
    writeRequestCart(cart, scopeA);
    expect(readRequestCart(scopeA)).toEqual(cart);
    expect(readRequestCart(scopeB)).toEqual([]);
    expect(readRequestCart(scopeC)).toEqual([]);
    expect(requestCartStorageKey(scopeA)).not.toBe(
      requestCartStorageKey(scopeB),
    );
    expect(requestCartStorageKey(scopeA)).not.toBe(
      requestCartStorageKey(scopeC),
    );
  });

  it("removes the old unscoped cart instead of attributing it to a new login", () => {
    localStorage.setItem("axora-request-cart:v1", JSON.stringify(cart));
    expect(readRequestCart(scopeA)).toEqual([]);
    expect(localStorage.getItem("axora-request-cart:v1")).toBeNull();
  });

  it("restores and clears only the current scoped draft", () => {
    const submissionKey = newRequestSubmissionKey();
    writeRequestDraft({
      branchId: "60000000-0000-4000-8000-000000000050",
      department: "Operations",
      neededByDate: "2026-08-10",
      requestType: "Recurring",
      urgency: "High",
      notes: "Keep this draft after a refresh.",
      submissionKey,
    }, scopeA);

    expect(readRequestDraft(scopeA)).toMatchObject({
      department: "Operations",
      requestType: "Recurring",
      urgency: "High",
      submissionKey,
    });
    expect(readRequestDraft(scopeB)).toBeNull();
    expect(readRequestDraft(scopeC)).toBeNull();

    clearRequestDraft(scopeA);
    expect(readRequestDraft(scopeA)).toBeNull();
  });

  it("fails closed on malformed or oversized draft data", () => {
    const key = requestDraftInternals.requestDraftStorageKey(scopeA);
    expect(key).toBeTruthy();
    localStorage.setItem(key!, JSON.stringify({
      branchId: "branch",
      department: "x".repeat(201),
      neededByDate: "not-a-date",
      requestType: "Unsupported",
      urgency: "Impossible",
      notes: "note",
      submissionKey: "not-a-uuid",
      updatedAt: "invalid",
    }));
    expect(readRequestDraft(scopeA)).toBeNull();
  });

  it("clears only the requested cart namespace", () => {
    writeRequestCart(cart, scopeA);
    writeRequestCart(cart, scopeB);
    clearRequestCart(scopeA);
    expect(readRequestCart(scopeA)).toEqual([]);
    expect(readRequestCart(scopeB)).toEqual(cart);
  });

  it("clears only the signed-out Delivery Agent's operational browser state", () => {
    const currentKeys = [
      `axora:delivery-commands:v2:${scopeA.userId}`,
      `axora:delivery-claim:v1:${scopeA.userId}`,
      `axora:delivery-reconciliation:v1:${scopeA.userId}`,
      `axora:driver:${scopeA.userId}:event-queue:v1`,
      `axora:delivery-location:v1:${scopeA.userId}`,
      `axora:delivery-location-device:v1:${scopeA.userId}`,
      `axora:delivery-location-paused:v1:${scopeA.userId}`,
      `axora:delivery-device:${scopeA.userId}`,
    ];
    const otherKey = `axora:delivery-location:v1:${scopeB.userId}`;
    for (const key of currentKeys) localStorage.setItem(key, "private-driver-state");
    localStorage.setItem(otherKey, "other-driver-state");
    localStorage.setItem("unrelated-application-state", "keep");

    clearDeliveryBrowserState(scopeA.userId);

    expect(currentKeys.every((key) => localStorage.getItem(key) === null)).toBe(true);
    expect(localStorage.getItem(otherKey)).toBe("other-driver-state");
    expect(localStorage.getItem("unrelated-application-state")).toBe("keep");
  });
});
