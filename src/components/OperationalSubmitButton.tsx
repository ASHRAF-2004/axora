"use client";

import { useFormStatus } from "react-dom";

export function OperationalSubmitButton({ label, pendingLabel, className = "text-button" }: { label: string; pendingLabel: string; className?: string }) {
  const { pending } = useFormStatus();
  return <button className={className} type="submit" disabled={pending} aria-busy={pending}>{pending ? pendingLabel : label}</button>;
}
