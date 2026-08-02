import { corePortalMessages } from "@/lib/core-portal-i18n";
import type { SupportedLocale } from "@/lib/i18n";

export function RouteLoadingScreen({
  message,
  locale = "en",
}: {
  message?: string;
  locale?: SupportedLocale;
}) {
  const copy = corePortalMessages(locale).loading;
  return (
    <div className="route-loading-screen" role="status" aria-live="polite">
      <div className="route-loading-card">
        {/* This boundary stays dependency-free so Next can emit it without an
            extra un-nonced loader chunk under the strict production CSP. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="brand-approved-lockup" src="/brand/axora-logo.png" width="190" height="35" alt="Axora" />
        <svg className="ux-spin" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-6.22-8.56" />
        </svg>
        <strong>{message ?? copy.title}</strong>
        <p>{copy.body}</p>
      </div>
    </div>
  );
}
