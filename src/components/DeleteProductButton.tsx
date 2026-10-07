"use client";

import { deleteProductAction } from "@/app/(portal)/masters/actions";
import { useUxFeedback } from "@/components/UxFeedbackProvider";
import { useActionState, useRef } from "react";
import { productDeletionMessages } from "@/lib/product-deletion-i18n";
import type { SupportedLocale } from "@/lib/i18n";

const initialState = { status: "idle", message: "" } as const;

export function DeleteProductButton({
  productId,
  productName,
  locale = "en",
}: {
  productId: string;
  productName: string;
  locale?: SupportedLocale;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const { confirm } = useUxFeedback();
  const copy = productDeletionMessages(locale);
  const [state, action, pending] = useActionState(deleteProductAction.bind(null, productId), initialState);
  const error = state.status === "error"
    ? copy.errors[state.message as keyof typeof copy.errors] ?? copy.errors.UNAVAILABLE : null;

  async function handleDelete() {
    const confirmed = await confirm({
      title: copy.title,
      message: copy.body(productName),
      confirmLabel: copy.label,
      cancelLabel: copy.cancel,
      destructive: true,
    });

    if (confirmed) {
      formRef.current?.requestSubmit();
    }
  }

  return (
    <form
      ref={formRef}
      action={action}
      data-feedback-label={copy.pending}
      style={{ marginTop: 8 }}
    >
      <button
        className="button button-danger"
        disabled={pending}
        type="button"
        data-ux-silent="true"
        onClick={handleDelete}
      >
        {pending ? copy.pending : copy.label}
      </button>
      {error ? <p className="form-alert" role="alert">{error}</p> : null}
    </form>
  );
}
