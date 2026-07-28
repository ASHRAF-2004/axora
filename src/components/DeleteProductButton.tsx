"use client";

import { deleteProductAction } from "@/app/(portal)/masters/actions";

export function DeleteProductButton({ productId, productName }: { productId: string; productName: string }) {
  return (
    <form
      action={deleteProductAction.bind(null, productId)}
      onSubmit={(event) => {
        const confirmed = window.confirm(
          `Permanently delete “${productName}”? This cannot be undone. Products already used in purchase requests will be protected.`,
        );
        if (!confirmed) event.preventDefault();
      }}
      style={{ marginTop: 8 }}
    >
      <button
        className="button button-secondary"
        style={{ borderColor: "#dc2626", color: "#b91c1c" }}
        type="submit"
      >
        Delete permanently
      </button>
    </form>
  );
}
