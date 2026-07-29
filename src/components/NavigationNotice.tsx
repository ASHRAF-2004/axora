"use client";

import { useUxFeedback } from "@/components/UxFeedbackProvider";
import { clearRequestCart } from "@/lib/request-cart";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

const messages: Record<string, string> = {
  "company-created": "Company created successfully.",
  "branch-created": "Branch created successfully.",
  "supplier-created": "Supplier created successfully.",
  "product-created":
    "Product created successfully. You can now review its details and images.",
  "product-updated": "Product changes saved successfully.",
  "user-created": "User account created successfully.",
  "budget-updated": "Branch budget updated successfully.",
  "pricing-updated":
    "Request pricing settings saved successfully.",
  "request-submitted":
    "Purchase request submitted successfully.",
};

export function NavigationNotice() {
  const { notify } = useUxFeedback();
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const notice = searchParams.get("notice");
    if (!notice) return;

    const message = messages[notice];

    if (notice === "request-submitted") {
      clearRequestCart();
    }

    if (message) notify(message, "success");

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("notice");

    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [notify, pathname, router, searchParams]);

  return null;
}
