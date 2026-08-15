"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, type ReactNode } from "react";
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
  const router = useRouter();
  const handledState = useRef<ProductActionState | null>(null);
  const [state, formAction, pending] = useActionState(action, INITIAL_PRODUCT_ACTION_STATE);

  useEffect(() => {
    if (state.status === "idle" || handledState.current === state) return;
    handledState.current = state;
    window.dispatchEvent(new CustomEvent("axora:form-action-outcome", {
      detail: { outcome: state.status },
    }));
    if (state.status === "success") router.push(state.redirectTo);
  }, [router, state]);

  return <form
    action={formAction}
    className="panel form-panel"
    data-action-status={state.status}
    data-draft-id={draftId}
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
