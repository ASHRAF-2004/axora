"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useTransition } from "react";
import { useFormStatus } from "react-dom";

export function GeneratedDocumentStatusPoller({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const refresh = useCallback(() => {
    if (document.visibilityState !== "visible" || !navigator.onLine) return;
    startTransition(() => router.refresh());
  }, [router]);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(refresh, 5_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [active, refresh]);

  return active ? <span className="sr-only" role="status" aria-live="polite">
    {pending ? label : ""}
  </span> : null;
}

export function GeneratedDocumentSubmitButton({
  label,
  pendingLabel,
  name,
  value,
  className = "button button-secondary",
  disabled = false,
}: {
  label: string;
  pendingLabel: string;
  name?: string;
  value?: string;
  className?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return <button aria-busy={pending} className={className}
    disabled={disabled || pending} name={name} type="submit" value={value}>
    {pending ? pendingLabel : label}
  </button>;
}
