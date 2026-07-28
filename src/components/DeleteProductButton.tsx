"use client";

import { deleteProductAction } from "@/app/(portal)/masters/actions";
import { useUxFeedback } from "@/components/UxFeedbackProvider";
import { useRef } from "react";

export function DeleteProductButton({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const { confirm } = useUxFeedback();

  async function handleDelete() {
    const confirmed = await confirm({
      title: "Delete product permanently?",
      message: `“${productName}” will be permanently removed. This cannot be undone. Products already used in purchase requests remain protected.`,
      confirmLabel: "Delete permanently",
      cancelLabel: "Keep product",
      destructive: true,
    });

    if (confirmed) {
      formRef.current?.requestSubmit();
    }
  }

  return (
    <form
      ref={formRef}
      action={deleteProductAction.bind(null, productId)}
      data-feedback-label={`Deleting ${productName}…`}
      style={{ marginTop: 8 }}
    >
      <button
        className="button button-secondary"
        style={{ borderColor: "#dc2626", color: "#b91c1c" }}
        type="button"
        data-ux-silent="true"
        onClick={handleDelete}
      >
        Delete permanently
      </button>
    </form>
  );
}
