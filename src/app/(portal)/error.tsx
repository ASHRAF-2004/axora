"use client";

import { AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { useSyncExternalStore } from "react";

const copy = {
  en: {
    title: "This page could not be restored",
    body: "Your secure session and current route were not discarded. Check the connection, then retry this page.",
    offline: "You are offline. Reconnect before retrying.",
    retry: "Retry this page",
  },
  ar: {
    title: "تعذر استعادة هذه الصفحة",
    body: "لم يتم حذف جلستك الآمنة أو مسارك الحالي. تحقق من الاتصال ثم أعد محاولة الصفحة.",
    offline: "أنت غير متصل بالإنترنت. أعد الاتصال قبل المحاولة.",
    retry: "إعادة محاولة الصفحة",
  },
  ms: {
    title: "Halaman ini tidak dapat dipulihkan",
    body: "Sesi selamat dan laluan semasa anda tidak dibuang. Semak sambungan, kemudian cuba semula halaman ini.",
    offline: "Anda di luar talian. Sambung semula sebelum mencuba.",
    retry: "Cuba semula halaman",
  },
} as const;

type Locale = keyof typeof copy;

function onlineSnapshot() {
  return window.navigator.onLine;
}

function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function localeSnapshot(): Locale {
  const value = document.documentElement.lang;
  return value === "ar" || value === "ms" ? value : "en";
}

function subscribeLocale(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["lang"],
  });
  return () => observer.disconnect();
}

export default function PortalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const online = useSyncExternalStore(
    subscribeOnline,
    onlineSnapshot,
    () => true,
  );
  const locale = useSyncExternalStore(
    subscribeLocale,
    localeSnapshot,
    () => "en" as const,
  );
  const messages = copy[locale];

  return (
    <main className="content-shell" role="alert" aria-live="assertive">
      <section className="panel form-panel" style={{ maxWidth: 720, margin: "48px auto" }}>
        <div className="panel-header">
          <div>
            <h1>{messages.title}</h1>
            <p>{online ? messages.body : messages.offline}</p>
          </div>
          {online
            ? <AlertTriangle size={30} aria-hidden="true" />
            : <WifiOff size={30} aria-hidden="true" />}
        </div>
        <div className="form-actions">
          <button
            className="button button-primary"
            type="button"
            disabled={!online}
            onClick={reset}
          >
            <RefreshCw size={17} aria-hidden="true" />
            {messages.retry}
          </button>
        </div>
      </section>
    </main>
  );
}
