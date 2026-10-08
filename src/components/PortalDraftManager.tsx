"use client";

import {
  createStoredFormDraft,
  clearSubmittedFormDraft,
  createFormDraftSaveQueue,
  FORM_DRAFT_PREFIX,
  formDraftStorageKey,
  isDraftableFormMethod,
  parseStoredFormDraft,
} from "@/lib/form-drafts";
import { collectFormDraft, draftableControls, restoreFormDraft } from "@/lib/form-draft-controls";
import type { SupportedLocale } from "@/lib/i18n";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";

function formIdentifier(form: HTMLFormElement) {
  const explicit = form.dataset.draftId || form.id;
  if (explicit) return explicit.slice(0, 200);
  const signature = [...new Set(draftableControls(form).map((control) => control.name))]
    .sort().join("|");
  let hash = 5381;
  for (const character of signature) hash = ((hash << 5) + hash) ^ character.charCodeAt(0);
  return `fields-${(hash >>> 0).toString(36)}`;
}

export function PortalDraftManager({
  userId,
  scopeKey,
  locale,
}: {
  userId: string;
  scopeKey: string;
  locale: SupportedLocale;
}) {
  const pathname = usePathname();
  void locale;
  const routeContext = useMemo(() => ({ userId, scopeKey, route: pathname }), [pathname, scopeKey, userId]);

  useEffect(() => {
    const storage = window.sessionStorage;
    const registered = new WeakSet<HTMLFormElement>();
    let disposed = false;
    const keyFor = (form: HTMLFormElement) => formDraftStorageKey({
      ...routeContext,
      formId: formIdentifier(form),
    });
    const save = (form: HTMLFormElement, submitted = false) => {
      if (disposed) return;
      writes.cancel(form);
      if (form.dataset.draftIgnore === "true" || draftableControls(form).length === 0) return;
      const key = keyFor(form);
      const content = collectFormDraft(form);
      storage.setItem(key, JSON.stringify(createStoredFormDraft(content.fields, content.fileFields, { submitted })));
    };
    const writes = createFormDraftSaveQueue(
      (form: HTMLFormElement) => save(form),
      { schedule: (callback, delay) => window.setTimeout(callback, delay), cancel: (timer) => window.clearTimeout(timer) },
    );
    const clear = (form: HTMLFormElement) => {
      if (disposed) return;
      writes.cancel(form);
      const key = keyFor(form);
      storage.removeItem(key);
    };
    const register = (form: HTMLFormElement) => {
      if (registered.has(form) || form.dataset.draftIgnore === "true"
        || !isDraftableFormMethod(form.method)) return;
      registered.add(form);
      const key = keyFor(form);
      const raw = storage.getItem(key);
      const draft = parseStoredFormDraft(raw);
      if (raw && !draft) storage.removeItem(key);
      if (draft) restoreFormDraft(form, draft);
      form.addEventListener("input", () => writes.schedule(form));
      form.addEventListener("change", () => save(form));
      form.addEventListener("submit", () => save(form, true));
      form.addEventListener("reset", () => clear(form));
    };
    const registerAll = () => document.querySelectorAll<HTMLFormElement>("main form, [data-app-shell-content] form")
      .forEach(register);
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(FORM_DRAFT_PREFIX) && !parseStoredFormDraft(storage.getItem(key))) {
        storage.removeItem(key);
      }
    }
    registerAll();
    const observer = new MutationObserver(registerAll);
    observer.observe(document.body, { childList: true, subtree: true });
    const outcome = (event: Event) => {
      const detail = (event as CustomEvent<{
        outcome?: string; formId?: string; completedForm?: unknown;
      }>).detail;
      if (detail && typeof detail === "object" && "completedForm" in detail) {
        if (detail.outcome === "success") clearSubmittedFormDraft(storage, routeContext, detail.completedForm);
        return;
      }
      document.querySelectorAll<HTMLFormElement>("form").forEach((form) => {
        if (detail?.formId && formIdentifier(form) !== detail.formId) return;
        const key = keyFor(form);
        const draft = parseStoredFormDraft(storage.getItem(key));
        if (!draft?.submittedAt) return;
        if (detail?.outcome === "success") clear(form);
        else storage.setItem(key, JSON.stringify({ ...draft, submittedAt: undefined }));
      });
    };
    window.addEventListener("axora:form-action-outcome", outcome);
    return () => {
      disposed = true;
      writes.dispose();
      observer.disconnect();
      window.removeEventListener("axora:form-action-outcome", outcome);
    };
  }, [routeContext]);

  return null;
}
