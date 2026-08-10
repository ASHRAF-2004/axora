"use client";

import { useSyncExternalStore, type ReactNode } from "react";

function subscribe() {
  return () => {};
}

export function DeferredOrganizationActions({
  children,
  label,
}: {
  children: ReactNode;
  label: string;
}) {
  const ready = useSyncExternalStore(subscribe, () => true, () => false);

  if (!ready) {
    return <p className="subtle" role="status" aria-live="polite" aria-busy="true">{label}</p>;
  }

  return <>{children}</>;
}
