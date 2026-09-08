"use client";

import { deleteBranchAction } from "@/app/(portal)/branches/actions";
import { useUxFeedback } from "@/components/UxFeedbackProvider";
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

const initialState = { status: "idle", message: "" } as const;

export function DeleteBranchButton({ branchId, copy }: {
  branchId: string;
  copy: { label: string; title: string; body: string; confirm: string; cancel: string; used: string; unavailable: string };
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const { confirm } = useUxFeedback();
  const router = useRouter();
  const [state, action, pending] = useActionState(deleteBranchAction, initialState);
  useEffect(() => {
    if (state.status === "success") router.replace("/branches?notice=branch-deleted");
  }, [router, state.status]);
  async function requestConfirmation() {
    if (await confirm({ title: copy.title, message: copy.body, confirmLabel: copy.confirm,
      cancelLabel: copy.cancel, destructive: true })) formRef.current?.requestSubmit();
  }
  const error = state.status === "error"
    ? state.message === "BRANCH_USED" ? copy.used : copy.unavailable : null;
  return <form ref={formRef} action={action} data-feedback-label={copy.confirm}>
    <input type="hidden" name="branchId" value={branchId} />
    <button className="button button-danger"
      type="button" disabled={pending} data-ux-silent="true" onClick={requestConfirmation}>{copy.label}</button>
    {error ? <p className="form-alert" role="alert">{error}</p> : null}
  </form>;
}
