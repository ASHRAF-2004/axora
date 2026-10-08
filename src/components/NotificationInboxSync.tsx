"use client";

import { LiveWorkspaceSync } from "./LiveWorkspaceSync";
import type { SupportedLocale } from "@/lib/i18n";

export function NotificationInboxSync({ versionToken, locale = "en" }: { versionToken: string; locale?: SupportedLocale }) {
  // Keep the existing server contract; transport epochs/versions own deduplication.
  void versionToken;
  return <LiveWorkspaceSync topics={["notifications"]} locale={locale} />;
}
