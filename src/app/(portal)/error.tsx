"use client";

import { AlertTriangle, House, RefreshCw, WifiOff } from "lucide-react";
import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import { safeErrorReference } from "@/lib/error-reference";

const copy = {
  en: {
    title: "Something went wrong",
    body: "We couldn't complete this page request. Try again, or return to the dashboard.",
    offline: "You're offline. Reconnect, then try again.",
    reference: "Reference",
    retry: "Try again",
    dashboard: "Return to dashboard",
  },
  ar: {
    title: "حدث خطأ ما",
    body: "تعذر إكمال طلب هذه الصفحة. أعد المحاولة أو ارجع إلى لوحة التحكم.",
    offline: "أنت غير متصل بالإنترنت. أعد الاتصال ثم حاول مرة أخرى.",
    reference: "المرجع",
    retry: "إعادة المحاولة",
    dashboard: "العودة إلى لوحة التحكم",
  },
  ms: {
    title: "Sesuatu tidak kena",
    body: "Permintaan halaman ini tidak dapat diselesaikan. Cuba lagi atau kembali ke papan pemuka.",
    offline: "Anda di luar talian. Sambung semula, kemudian cuba lagi.",
    reference: "Rujukan",
    retry: "Cuba lagi",
    dashboard: "Kembali ke papan pemuka",
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
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
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
  const reference = safeErrorReference(error.digest);
  const retryPage = () => {
    reset();
    router.refresh();
  };

  return (
    <div
      className="content-shell"
      role="alert"
      aria-live="assertive"
      data-testid="portal-error-boundary"
    >
      <section className="panel form-panel" style={{ maxWidth: 720, margin: "48px auto" }}>
        <div className="panel-header">
          <div>
            <h1>{online ? messages.title : messages.offline}</h1>
            {online ? <p>{messages.body}</p> : null}
            {reference ? (
              <p>
                <strong>{messages.reference}:</strong> <code>{reference}</code>
              </p>
            ) : null}
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
            onClick={retryPage}
          >
            <RefreshCw size={17} aria-hidden="true" />
            {messages.retry}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => router.push("/dashboard")}
          >
            <House size={17} aria-hidden="true" />
            {messages.dashboard}
          </button>
        </div>
      </section>
    </div>
  );
}
