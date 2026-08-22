"use client";

import {
  recordApprovalAction,
  type ApprovalActionState,
} from "@/app/(portal)/operations/actions";
import { useUxFeedback } from "@/components/UxFeedbackProvider";
import { useRouter } from "next/navigation";
import { corePortalMessages } from "@/lib/core-portal-i18n";
import type { SupportedLocale } from "@/lib/i18n";
import {
  useActionState,
  useEffect,
  useRef,
} from "react";

const initialState: ApprovalActionState = {
  status: "idle",
  message: "",
  submissionId: 0,
};

export function ApprovalDecisionForm({
  requestId,
  approvalDisabled = false,
  locale = "en",
}: {
  requestId: string;
  approvalDisabled?: boolean;
  locale?: SupportedLocale;
}) {
  const copy = corePortalMessages(locale).approvals;
  const router = useRouter();
  const { notify } = useUxFeedback();
  const formRef = useRef<HTMLFormElement>(null);
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

  return (
    <form
      ref={formRef}
      action={formAction}
      className="form-panel"
      style={{ padding: 0 }}
      noValidate
    >
      <input name="requestId" type="hidden" value={requestId} />

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
          data-feedback-label={copy.approving}
        >
          {pending ? copy.processing : copy.approve}
        </button>

        <button
          className="button button-secondary"
          name="status"
          value="Rejected"
          type="submit"
          disabled={pending}
          data-feedback-label={copy.rejecting}
        >
          {pending ? copy.processing : copy.reject}
        </button>
      </div>

      <small>
        {copy.decisionHelp}
      </small>
    </form>
  );
}
