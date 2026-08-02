"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

export function SecuritySubmitButton({
  label,
  pendingLabel,
  disabled = false,
}: {
  label: string;
  pendingLabel: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className="button button-primary button-full"
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      data-feedback-label={pendingLabel}
    >
      {pending ? <><LoaderCircle className="ux-spin" size={18} />{pendingLabel}</> : label}
    </button>
  );
}
