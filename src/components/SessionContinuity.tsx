"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { SupportedLocale } from "@/lib/i18n";
import type { BrowserSessionScope } from "@/lib/browser-session-scope";
import { clearRequestCart } from "@/lib/request-cart";
import { clearRequestDraft } from "@/lib/request-draft";
import {
  clearBrowserReturnPath,
  recordBrowserReturnPath,
} from "@/lib/session-return";

const copy = {
  en: {
    offline: "You are offline. This page stays open and your scoped draft remains on this device. Reconnect before submitting or refreshing.",
    online: "Connection restored.",
  },
  ar: {
    offline: "أنت غير متصل بالإنترنت. ستبقى هذه الصفحة مفتوحة وتظل المسودة المقيّدة محفوظة على هذا الجهاز. أعد الاتصال قبل الإرسال أو التحديث.",
    online: "تمت استعادة الاتصال.",
  },
  ms: {
    offline: "Anda di luar talian. Halaman ini kekal terbuka dan draf berskop anda kekal pada peranti ini. Sambung semula sebelum menghantar atau memuat semula.",
    online: "Sambungan dipulihkan.",
  },
} as const;

export function clearBrowserSessionWorkspace(scope: BrowserSessionScope) {
  clearBrowserReturnPath();
  clearRequestCart(scope);
  clearRequestDraft(scope);
}

export function SessionContinuity({
  locale,
}: {
  locale: SupportedLocale;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [online, setOnline] = useState(true);
  const [restored, setRestored] = useState(false);

  useEffect(() => {
    const sync = () => {
      const nextOnline = window.navigator.onLine;
      setOnline(nextOnline);
      if (nextOnline) {
        setRestored(true);
        window.setTimeout(() => setRestored(false), 2_500);
      } else {
        setRestored(false);
      }
    };
    setOnline(window.navigator.onLine);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    const query = searchParams.toString();
    const record = () => recordBrowserReturnPath(
      `${pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
    record();
    window.addEventListener("hashchange", record);
    window.addEventListener("pageshow", record);
    return () => {
      window.removeEventListener("hashchange", record);
      window.removeEventListener("pageshow", record);
    };
  }, [pathname, searchParams]);

  if (online && !restored) return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      data-session-connectivity={online ? "restored" : "offline"}
      style={{
        position: "fixed",
        insetInline: "max(16px, env(safe-area-inset-left))",
        insetBlockEnd: "max(16px, env(safe-area-inset-bottom))",
        zIndex: 1200,
        maxWidth: 720,
        marginInline: "auto",
        padding: "12px 16px",
        border: "1px solid var(--slate-300)",
        borderRadius: 12,
        background: "var(--surface, white)",
        boxShadow: "0 14px 36px rgba(15, 23, 42, 0.18)",
        fontWeight: 650,
      }}
    >
      {online ? copy[locale].online : copy[locale].offline}
    </aside>
  );
}
