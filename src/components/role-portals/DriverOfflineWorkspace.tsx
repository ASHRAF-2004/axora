"use client";

import { DeliveryExecutionPanel } from "./DeliveryExecutionPanel";

// Keep the established portal export while routing all new work through the
// canonical server-owned workflow and its versioned offline command queue.
export function DriverOfflineWorkspace(props: Record<string, unknown>) {
  void props;
  return <DeliveryExecutionPanel />;
}
