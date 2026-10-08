import { afterEach, describe, expect, it, vi } from "vitest";
import { completedProductActionForm } from "@/components/NavigationNotice";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import {
  clearSubmittedFormDraft, createFormDraftSaveQueue, createStoredFormDraft, formDraftStorageKey,
} from "@/lib/form-drafts";

const scope = { userId: "owner-fixture", scopeKey: "platform-fixture" };
const completed = { route: "/products/new", formId: "create-product" };
const editor = "/products/30000000-0000-4000-8000-000000000099/edit";

function fixtureStorage() {
  const records = new Map<string, string>();
  return {
    records,
    getItem: (key: string) => records.get(key) ?? null,
    removeItem: (key: string) => { records.delete(key); },
  };
}

function putDraft(
  storage: ReturnType<typeof fixtureStorage>,
  context = { ...scope, ...completed },
  submitted = true,
) {
  const key = formDraftStorageKey(context);
  storage.records.set(key, JSON.stringify(createStoredFormDraft({ name: ["Controlled product"] }, [], { submitted })));
  return key;
}

describe("redirected form draft completion", () => {
  afterEach(() => vi.useRealTimers());

  it.each(["product-created", "product-draft-created", "product-created-image-retry"])(
    "recognizes %s only at the created product editor",
    (notice) => {
      expect(completedProductActionForm(editor, notice)).toEqual(completed);
      for (const route of ["/products/new", "/products", "/users", "/products/not-a-uuid/edit", `${editor}/extra`]) {
        expect(completedProductActionForm(route, notice)).toBeUndefined();
      }
    },
  );

  it("targets upload completion only to its current editor upload form", () => {
    expect(completedProductActionForm(editor, "product-images-updated"))
      .toEqual({ route: editor, formId: "product-image-upload" });
    expect(completedProductActionForm("/products/new", "product-images-updated")).toBeUndefined();
  });

  it("does not treat update or error notices as product completion", () => {
    for (const notice of ["product-updated", "product-image-required", "unknown"]) {
      expect(completedProductActionForm(editor, notice)).toBeUndefined();
    }
  });

  it("clears only the submitted source draft in the current user and scope", () => {
    const storage = fixtureStorage();
    const own = putDraft(storage);
    const others = [
      putDraft(storage, { ...scope, ...completed, userId: "another-user" }),
      putDraft(storage, { ...scope, ...completed, scopeKey: "another-scope" }),
      putDraft(storage, { ...scope, ...completed, route: "/users/new" }),
      putDraft(storage, { ...scope, ...completed, formId: "another-form" }),
    ];
    expect(clearSubmittedFormDraft(storage, scope, completed)).toBe(true);
    expect(storage.records.has(own)).toBe(false);
    for (const key of others) expect(storage.records.has(key)).toBe(true);
    expect(clearSubmittedFormDraft(storage, scope, completed)).toBe(false);
  });

  it("retains unsubmitted and error-recovered drafts", () => {
    const storage = fixtureStorage();
    const key = putDraft(storage, { ...scope, ...completed }, false);
    expect(clearSubmittedFormDraft(storage, scope, completed)).toBe(false);
    expect(storage.records.has(key)).toBe(true);
    const draft = createStoredFormDraft({ name: ["Preserved after error"] }, [], { submitted: true });
    storage.records.set(key, JSON.stringify({ ...draft, submittedAt: undefined }));
    expect(clearSubmittedFormDraft(storage, scope, completed)).toBe(false);
    expect(storage.records.has(key)).toBe(true);
  });

  it("rejects malformed completion descriptors without touching any stored record", () => {
    const storage = fixtureStorage();
    putDraft(storage);
    const before = [...storage.records];
    for (const invalid of [null, "create-product", {}, { ...completed, route: "//external.example" },
      { ...completed, route: "/products/new?notice=done" }, { ...completed, route: "/products/new#done" },
      { ...completed, route: "/" + "x".repeat(512) }, { ...completed, formId: "" },
      { ...completed, formId: " create-product" }, { ...completed, formId: "x".repeat(201) }]) {
      expect(clearSubmittedFormDraft(storage, scope, invalid)).toBe(false);
    }
    expect([...storage.records]).toEqual(before);
  });

  it("does not clear an invalid or expired submission marker", () => {
    const storage = fixtureStorage();
    const key = putDraft(storage);
    const draft = JSON.parse(storage.records.get(key)!);
    storage.records.set(key, JSON.stringify({ ...draft, submittedAt: "not-a-timestamp" }));
    expect(clearSubmittedFormDraft(storage, scope, completed)).toBe(false);
    storage.records.set(key, JSON.stringify({ ...draft, expiresAt: Date.now() - 1 }));
    expect(clearSubmittedFormDraft(storage, scope, completed)).toBe(false);
    expect(storage.records.has(key)).toBe(true);
  });

  it("debounces edits and cancels the old write when a submission completes", () => {
    vi.useFakeTimers();
    const storage = fixtureStorage();
    const key = formDraftStorageKey({ ...scope, ...completed });
    const writes = createFormDraftSaveQueue(
      () => putDraft(storage, { ...scope, ...completed }, false),
      { schedule: setTimeout, cancel: clearTimeout },
    );
    writes.schedule("create-form");
    vi.advanceTimersByTime(150);
    writes.schedule("create-form");
    vi.advanceTimersByTime(150);
    expect(storage.records.has(key)).toBe(false);
    putDraft(storage);
    writes.cancel("create-form");
    expect(clearSubmittedFormDraft(storage, scope, completed)).toBe(true);
    vi.advanceTimersByTime(350);
    expect(storage.records.has(key)).toBe(false);
  });

  it("still saves ordinary edits after the existing 300ms debounce", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    const writes = createFormDraftSaveQueue(save, { schedule: setTimeout, cancel: clearTimeout });
    writes.schedule("unfinished-form");
    vi.advanceTimersByTime(299);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledExactlyOnceWith("unfinished-form");
  });

  it("prevents pending and already-queued callbacks from writing after route or scope disposal", () => {
    vi.useFakeTimers();
    const save = vi.fn();
    let lateCallback = () => {};
    const writes = createFormDraftSaveQueue(save, {
      schedule: (callback, delay) => { lateCallback = callback; return setTimeout(callback, delay); },
      cancel: clearTimeout,
    });
    writes.schedule("old-create-form");
    writes.dispose();
    vi.advanceTimersByTime(350);
    lateCallback();
    writes.schedule("old-create-form");
    vi.runAllTimers();
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps the upload success message localized in all supported catalogs", () => {
    const expected = {
      en: "Product images uploaded successfully.",
      ar: "تم تحميل صور المنتج بنجاح.",
      ms: "Imej produk berjaya dimuat naik.",
    } as const;
    for (const locale of ["en", "ar", "ms"] as const) {
      expect(corePortalMessages(locale).notices["product-images-updated"].message).toBe(expected[locale]);
      expect(corePortalMessages(locale).notices["product-created-image-retry"].tone).toBe("error");
      expect(corePortalMessages(locale).notices["product-created-image-retry"].message).toBeTruthy();
      expect(corePortalMessages(locale).notices["product-draft-created"].message).toBeTruthy();
    }
    expect(new Set(["en", "ar", "ms"].map((locale) => corePortalMessages(locale as "en" | "ar" | "ms").notices["product-created-image-retry"].message)).size).toBe(3);
  });
});
