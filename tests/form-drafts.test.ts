import { describe, expect, it } from "vitest";
import {
  createStoredFormDraft,
  FORM_DRAFT_SCHEMA_VERSION,
  formDraftStorageKey,
  isDraftableFormMethod,
  isSafeDraftField,
  parseStoredFormDraft,
} from "@/lib/form-drafts";

describe("portal form drafts", () => {
  it("isolates keys by user, scope, route, and form", () => {
    const base = { userId: crypto.randomUUID(), scopeKey: "company-a", route: "/users", formId: "create-user" };
    const key = formDraftStorageKey(base);
    expect(formDraftStorageKey({ ...base, userId: crypto.randomUUID() })).not.toBe(key);
    expect(formDraftStorageKey({ ...base, scopeKey: "company-b" })).not.toBe(key);
    expect(formDraftStorageKey({ ...base, route: "/companies" })).not.toBe(key);
    expect(formDraftStorageKey({ ...base, formId: "company-create" })).not.toBe(key);
  });

  it("never accepts credential or secret fields", () => {
    for (const name of ["password", "currentPassword", "setupToken", "csrf", "api_key", "webhookSecret", "payment_secret"]) {
      expect(isSafeDraftField(name)).toBe(false);
    }
    expect(isSafeDraftField("displayName")).toBe(true);
    expect(isSafeDraftField("notes", "textarea")).toBe(true);
    expect(isSafeDraftField("logo", "file")).toBe(false);
    expect(isSafeDraftField("companyId", "hidden")).toBe(false);
  });

  it("leaves URL-owned GET filters out of form draft persistence", () => {
    expect(isDraftableFormMethod("get")).toBe(false);
    expect(isDraftableFormMethod("GET")).toBe(false);
    expect(isDraftableFormMethod("post")).toBe(true);
  });

  it("restores only current bounded schema records", () => {
    const now = Date.now();
    const draft = createStoredFormDraft({ displayName: ["Restored name"] }, ["logo"], { now });
    expect(parseStoredFormDraft(JSON.stringify(draft), now + 1)).toEqual(draft);
    expect(parseStoredFormDraft(JSON.stringify({ ...draft, expiresAt: now - 1 }), now)).toBeNull();
    expect(parseStoredFormDraft(JSON.stringify({ ...draft, schemaVersion: FORM_DRAFT_SCHEMA_VERSION + 1 }), now)).toBeNull();
    expect(parseStoredFormDraft(JSON.stringify({ ...draft, fields: { password: ["never"] } }), now)).toBeNull();
  });

  it("marks submitted drafts without clearing them before success", () => {
    const now = Date.now();
    const draft = createStoredFormDraft({ notes: ["keep on failure"] }, [], { now, submitted: true });
    expect(draft.submittedAt).toBe(now);
    expect(parseStoredFormDraft(JSON.stringify(draft), now + 1)?.fields.notes).toEqual(["keep on failure"]);
  });
});
