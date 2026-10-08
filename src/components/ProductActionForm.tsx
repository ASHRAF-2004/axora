"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
import {
  type ProductActionState,
} from "@/app/(portal)/masters/actions";
import { collectFormDraft, restoreFormDraft } from "@/lib/form-draft-controls";
import { createStoredFormDraft, parseStoredFormDraft, type StoredFormDraft } from "@/lib/form-drafts";

const INITIAL_PRODUCT_ACTION_STATE: ProductActionState = { status: "idle" };

export function ProductActionForm({
  action, children, submitLabel, draftId,
}: {
  action: (state: ProductActionState, formData: FormData) => Promise<ProductActionState>;
  children: ReactNode;
  submitLabel: string;
  draftId?: string;
}) {
  const router = useRouter();
  const handledState = useRef<ProductActionState | null>(null);
  const form = useRef<HTMLFormElement | null>(null);
  const submittedDraft = useRef<StoredFormDraft | null>(null);
  const [state, formAction, pending] = useActionState(action, INITIAL_PRODUCT_ACTION_STATE);
  const captureDraft = (currentForm: HTMLFormElement) => {
    if (currentForm !== form.current) return;
    const content = collectFormDraft(currentForm);
    submittedDraft.current = parseStoredFormDraft(JSON.stringify(
      createStoredFormDraft(content.fields, content.fileFields, { submitted: true }),
    ));
  };

  useEffect(() => {
    if (state.status === "idle" || handledState.current === state) return;
    handledState.current = state;
    if (state.status === "error" && draftId && form.current && submittedDraft.current) {
      // A fulfilled action resets uncontrolled controls even when its result is
      // a validation error. Restore only this form's bounded, safe RAM snapshot.
      restoreFormDraft(form.current, submittedDraft.current, { notify: false });
      submittedDraft.current = null;
      form.current.dispatchEvent(new Event("input", { bubbles: true }));
      form.current.dispatchEvent(new Event("change", { bubbles: true }));
    }
    window.dispatchEvent(new CustomEvent("axora:form-action-outcome", {
      detail: { outcome: state.status, ...(draftId ? { formId: draftId } : {}) },
    }));
    if (state.status === "success") {
      submittedDraft.current = null;
      router.push(state.redirectTo);
    }
  }, [draftId, router, state]);

  return <form
    action={formAction}
    ref={form}
    className="panel form-panel"
    data-action-status={state.status}
    data-draft-id={draftId}
    onSubmit={draftId ? (event) => captureDraft(event.currentTarget) : undefined}
    onInput={draftId ? (event) => {
      if (pending) captureDraft(event.currentTarget);
    } : undefined}
    onChange={draftId ? (event) => {
      if (pending) captureDraft(event.currentTarget);
    } : undefined}
    onReset={draftId ? () => {
      // Keep the snapshot through pending/new-error resets before the effect.
      // Idle/handled-error resets discard it; this form has no pending reset UI.
      if (!pending && !(state.status === "error" && handledState.current !== state)) {
        submittedDraft.current = null;
      }
    } : undefined}
  >
    {children}
    {state.status === "error"
      ? <p className="callout callout-warning" role="alert">{state.message}</p>
      : null}
    <div className="form-actions">
      <button className="button button-primary" type="submit" disabled={pending}>{submitLabel}</button>
    </div>
  </form>;
}
