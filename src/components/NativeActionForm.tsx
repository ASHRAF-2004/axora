"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { submitNativeServerAction } from "@/lib/native-form-submit";

export function NativeActionForm({ children, ...props }: ComponentProps<"form">) {
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const restored = () => setPending(false);
    window.addEventListener("pageshow", restored);
    return () => window.removeEventListener("pageshow", restored);
  }, []);
  return <form {...props} aria-busy={pending} onSubmitCapture={event => {
    if (pending) { event.preventDefault(); event.stopPropagation(); return; }
    if (submitNativeServerAction(event)) setPending(true);
  }}>{children}</form>;
}
