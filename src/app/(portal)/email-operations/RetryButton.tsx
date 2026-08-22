"use client";

import { RotateCcw } from "lucide-react";
import { useFormStatus } from "react-dom";
import styles from "./EmailOperations.module.css";

export function RetryButton({ label, pendingLabel }: {
  label: string;
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button className={styles.retryButton} type="submit" disabled={pending}>
      <RotateCcw size={16} aria-hidden="true" />
      {pending ? pendingLabel : label}
    </button>
  );
}
