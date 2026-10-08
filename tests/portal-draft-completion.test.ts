import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStoredFormDraft, formDraftStorageKey, parseStoredFormDraft } from "@/lib/form-drafts";

const hooks = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[] }));
const editor = "/products/30000000-0000-4000-8000-000000000099/edit";
vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect),
  useMemo: (compute: () => unknown) => compute(),
}));
vi.mock("next/navigation", () => ({ usePathname: () => editor }));

import { PortalDraftManager } from "@/components/PortalDraftManager";

const scope = { userId: "owner-fixture", scopeKey: "platform-fixture" };
const source = { ...scope, route: "/products/new", formId: "create-product" };
const destination = { ...scope, route: editor, formId: "edit-product" };

describe("portal draft completion events", () => {
  let records: Map<string, string>;
  let events: EventTarget;
  let cleanup: void | (() => void);

  function put(context: typeof source, submitted = true) {
    const key = formDraftStorageKey(context);
    records.set(key, JSON.stringify(createStoredFormDraft({ name: ["Controlled draft"] }, [], { submitted })));
    return key;
  }

  function mount() {
    PortalDraftManager({ ...scope, locale: "en" });
    cleanup = hooks.effects.at(-1)!();
  }

  function outcome(detail: unknown) {
    events.dispatchEvent(new CustomEvent("axora:form-action-outcome", { detail }));
  }

  beforeEach(() => {
    hooks.effects.length = 0;
    cleanup = undefined;
    records = new Map();
    events = new EventTarget();
    Object.assign(events, {
      sessionStorage: {
        get length() { return records.size; },
        key: (index: number) => [...records.keys()][index] ?? null,
        getItem: (key: string) => records.get(key) ?? null,
        setItem: (key: string, value: string) => records.set(key, value),
        removeItem: (key: string) => records.delete(key),
      },
      setTimeout, clearTimeout,
    });
    vi.stubGlobal("window", events);
    vi.stubGlobal("document", {
      body: {},
      // Initial form registration is irrelevant to these outcome events. The
      // current editor form is present when the real outcome handler queries it.
      querySelectorAll: (selector: string) => selector === "form"
        ? [{ dataset: { draftId: "edit-product" } }] : [],
    });
    vi.stubGlobal("MutationObserver", class {
      observe() {}
      disconnect() {}
    });
  });

  afterEach(() => {
    if (cleanup) cleanup();
    vi.unstubAllGlobals();
  });

  it("clears the completed source without clearing an unrelated submitted editor draft", () => {
    const sourceKey = put(source);
    const destinationKey = put(destination);
    mount();
    outcome({ outcome: "success", completedForm: { route: source.route, formId: source.formId } });
    expect(records.has(sourceKey)).toBe(false);
    expect(parseStoredFormDraft(records.get(destinationKey)!)?.submittedAt).toEqual(expect.any(Number));
  });

  it("clears only the submitted upload draft while preserving editor and image-description drafts", () => {
    const upload = { ...scope, route: editor, formId: "product-image-upload" };
    const uploadKey = put(upload);
    const editorKey = put(destination);
    const captionKey = put({ ...destination, formId: "image-description" });
    mount();
    outcome({ outcome: "success", completedForm: { route: upload.route, formId: upload.formId } });
    expect(records.has(uploadKey)).toBe(false);
    for (const key of [editorKey, captionKey]) {
      expect(parseStoredFormDraft(records.get(key)!)?.submittedAt).toEqual(expect.any(Number));
    }
  });

  it.each([undefined, null, {}, { route: "//external.example", formId: "create-product" }])(
    "does not apply malformed source completion to destination forms (%j)",
    (completedForm) => {
      const sourceKey = put(source);
      const destinationKey = put(destination);
      mount();
      outcome({ outcome: "success", completedForm });
      expect(records.has(sourceKey)).toBe(true);
      expect(parseStoredFormDraft(records.get(destinationKey)!)?.submittedAt).toEqual(expect.any(Number));
    },
  );

  it("does not clear either draft for an unsuccessful source completion", () => {
    const sourceKey = put(source);
    const destinationKey = put(destination);
    mount();
    outcome({ outcome: "error", completedForm: { route: source.route, formId: source.formId } });
    expect(records.has(sourceKey)).toBe(true);
    expect(parseStoredFormDraft(records.get(destinationKey)!)?.submittedAt).toEqual(expect.any(Number));
  });

  it("preserves ordinary current-form success and error outcomes", () => {
    const key = put(destination);
    mount();
    outcome({ outcome: "error" });
    expect(parseStoredFormDraft(records.get(key)!)?.fields.name).toEqual(["Controlled draft"]);
    expect(parseStoredFormDraft(records.get(key)!)?.submittedAt).toBeUndefined();
    put(destination);
    outcome({ outcome: "success" });
    expect(records.has(key)).toBe(false);
  });

  it("does not change an unrelated submitted form for a scoped creation error", () => {
    const destinationKey = put(destination);
    mount();
    outcome({ outcome: "error", formId: "create-product" });
    expect(parseStoredFormDraft(records.get(destinationKey)!)?.submittedAt).toEqual(expect.any(Number));
  });
});
