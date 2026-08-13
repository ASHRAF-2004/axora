"use client";

import { useActionState, useCallback, type ReactNode } from "react";
import {
  type ProductActionState,
} from "@/app/(portal)/masters/actions";

const INITIAL_PRODUCT_ACTION_STATE: ProductActionState = { status: "idle" };

export function ProductActionForm({
  action, children, submitLabel, draftId,
}: {
  action: (state: ProductActionState, formData: FormData) => Promise<ProductActionState>;
  children: ReactNode;
  submitLabel: string;
  draftId?: string;
}) {
  const resilientAction = useCallback(async (
    state: ProductActionState,
    formData: FormData,
  ) => {
    try {
      return await action(state, formData);
    } catch (error) {
      const digest = error && typeof error === "object" && "digest" in error
        ? String(error.digest)
        : "";
      if (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_NOT_FOUND")) {
        throw error;
      }
      // A tab opened before a deployment can hold an obsolete Next.js Server
      // Action identifier. Refresh the document to load the current action
      // manifest; PortalDraftManager preserves the safe product fields.
      window.location.reload();
      return {
        status: "error" as const,
        message: "Axora refreshed this form to use the latest application version. Your saved progress is preserved.",
      };
    }
  }, [action]);
  const [state, formAction, pending] = useActionState(
    resilientAction,
    INITIAL_PRODUCT_ACTION_STATE,
  );
  return <form action={formAction} className="panel form-panel" data-draft-id={draftId}>
    {children}
    {state.status === "error"
      ? <p className="callout callout-warning" role="alert">{state.message}</p>
      : null}
    <div className="form-actions">
      <button className="button button-primary" type="submit" disabled={pending}>{submitLabel}</button>
    </div>
  </form>;
}
