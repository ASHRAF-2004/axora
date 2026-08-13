"use client";

import { useActionState, type ReactNode } from "react";
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
  const [state, formAction, pending] = useActionState(action, INITIAL_PRODUCT_ACTION_STATE);
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
