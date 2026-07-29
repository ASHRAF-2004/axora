"use client";

import {
  recordApprovalAction,
  type ApprovalActionState,
} from "@/app/(portal)/operations/actions";
import { useUxFeedback } from "@/components/UxFeedbackProvider";
import { useRouter } from "next/navigation";
import {
  useActionState,
  useEffect,
  useRef,
  type FormEvent,
} from "react";

const initialState: ApprovalActionState = {
  status: "idle",
  message: "",
  submissionId: 0,
};

export function ApprovalDecisionForm({
  requestId,
  approvalDisabled = false,
}: {
  requestId: string;
  approvalDisabled?: boolean;
}) {
  const router = useRouter();
  const { notify } = useUxFeedback();
  const formRef = useRef<HTMLFormElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [state, formAction, pending] = useActionState(
    recordApprovalAction,
    initialState,
  );

  useEffect(() => {
    if (!state.submissionId) return;

    const form = formRef.current;
    form?.removeAttribute("aria-busy");
    form
      ?.querySelectorAll("[data-ux-pending]")
      .forEach((element) => element.removeAttribute("data-ux-pending"));

    notify(
      state.message,
      state.status === "error" ? "error" : "success",
    );

    if (state.status === "success") {
      router.refresh();
    }
  }, [
    state.submissionId,
    state.message,
    state.status,
    notify,
    router,
  ]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter;

    if (
      submitter instanceof HTMLButtonElement &&
      submitter.value === "Rejected" &&
      !reasonRef.current?.value.trim()
    ) {
      event.preventDefault();
      notify(
        "Enter a reason before rejecting this purchase request.",
        "error",
      );
      reasonRef.current?.focus();
    }
  }

  const reasonError =
    state.status === "error" && state.field === "reason";

  return (
    <form
      ref={formRef}
      action={formAction}
      className="form-panel"
      style={{ padding: 0 }}
      noValidate
      onSubmit={handleSubmit}
    >
      <input name="requestId" type="hidden" value={requestId} />

      <label>
        Approval note
        <textarea
          ref={reasonRef}
          name="reason"
          placeholder="Reason or conditions for this decision"
          aria-invalid={reasonError}
          aria-describedby={
            reasonError ? `approval-error-${requestId}` : undefined
          }
        />
      </label>

      {state.status === "error" ? (
        <p
          id={`approval-error-${requestId}`}
          className="request-field-error-message"
          role="alert"
        >
          {state.message}
        </p>
      ) : null}

      <div className="form-actions">
        <button
          className="button button-primary"
          name="status"
          value="Approved"
          type="submit"
          disabled={pending || approvalDisabled}
          data-feedback-label="Approving purchase request…"
        >
          {pending ? "Processing…" : "Approve request"}
        </button>

        <button
          className="button button-secondary"
          name="status"
          value="Rejected"
          type="submit"
          disabled={pending}
          data-feedback-label="Rejecting purchase request…"
        >
          {pending ? "Processing…" : "Reject request"}
        </button>
      </div>

      <small>
        A rejection requires a reason. Approval commits this amount to
        the branch&apos;s current monthly budget.
      </small>
    </form>
  );
}
