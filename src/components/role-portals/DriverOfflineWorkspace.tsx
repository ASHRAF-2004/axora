"use client";

import { DeliveryExecutionPanel } from "./DeliveryExecutionPanel";
import type { SupportedLocale } from "@/lib/i18n";

// Keep the established portal export while routing all new work through the
// canonical server-owned workflow and its versioned offline command queue.
export function DriverOfflineWorkspace({ locale = "en" }: { locale?: SupportedLocale }) {
  return <DeliveryExecutionPanel locale={locale} />;
}
