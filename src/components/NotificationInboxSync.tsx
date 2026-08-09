"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

interface NotificationSummaryDetail {
  versionToken?: string;
}

export function NotificationInboxSync({ versionToken }: { versionToken: string }) {
  const router = useRouter();
  const currentVersion = useRef(versionToken);

  useEffect(() => {
    currentVersion.current = versionToken;
  }, [versionToken]);

  useEffect(() => {
    function refreshOnChange(event: Event) {
      const detail = (event as CustomEvent<NotificationSummaryDetail>).detail;
      if (!detail?.versionToken || detail.versionToken === currentVersion.current) return;
      currentVersion.current = detail.versionToken;
      router.refresh();
    }
    window.addEventListener("axora:notification-summary", refreshOnChange);
    return () => window.removeEventListener(
      "axora:notification-summary",
      refreshOnChange,
    );
  }, [router]);

  return null;
}
