"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

export function AccountSetupSubmitButton({
  disabled = false,
  createLabel = "Create password",
  savingLabel = "Saving password…",
  feedbackLabel = "Securing your Axora account…",
}: {
  disabled?: boolean;
  createLabel?: string;
  savingLabel?: string;
  feedbackLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className="button button-primary button-full"
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      data-feedback-label={feedbackLabel}
    >
      {pending ? <><LoaderCircle className="ux-spin" size={18} /> {savingLabel}</> : createLabel}
    </button>
  );
}
