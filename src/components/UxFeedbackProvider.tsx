"use client";

import {
  AlertTriangle,
  Check,
  Info,
  LoaderCircle,
  X,
} from "lucide-react";
import { usePathname } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type FeedbackTone = "loading" | "success" | "error" | "info";

type FeedbackState = {
  message: string;
  tone: FeedbackTone;
} | null;

type ConfirmOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type PendingConfirmation = ConfirmOptions & {
  resolve: (confirmed: boolean) => void;
};

type PendingFormState = {
  form: HTMLFormElement;
  submitter: HTMLElement | null;
  observer: MutationObserver | null;
  frameworkPendingSeen: boolean;
};

type UxFeedbackContextValue = {
  notify: (message: string, tone?: Exclude<FeedbackTone, "loading">) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const UxFeedbackContext = createContext<UxFeedbackContextValue | null>(null);

const uiCopy = {
  en: {
    processing: "Processing your request...",
    navigation: "Opening the requested page...",
    requestUncertain: "This is taking longer than expected. Do not repeat the action; navigate or refresh to verify its result.",
    navigationUncertain: "Navigation did not complete. You can retry the link safely.",
    dismiss: "Dismiss notification", cancel: "Cancel", confirm: "Confirm",
  },
  ar: {
    processing: "جارٍ معالجة طلبك...",
    navigation: "جارٍ فتح الصفحة المطلوبة...",
    requestUncertain: "يستغرق هذا وقتاً أطول من المتوقع. لا تكرر الإجراء؛ انتقل أو حدّث الصفحة للتحقق من النتيجة.",
    navigationUncertain: "لم يكتمل الانتقال. يمكنك إعادة محاولة فتح الرابط بأمان.",
    dismiss: "إغلاق الإشعار", cancel: "إلغاء", confirm: "تأكيد",
  },
  ms: {
    processing: "Memproses permintaan anda...",
    navigation: "Membuka halaman yang diminta...",
    requestUncertain: "Ini mengambil masa lebih lama daripada dijangka. Jangan ulang tindakan; navigasi atau muat semula untuk mengesahkan hasilnya.",
    navigationUncertain: "Navigasi tidak selesai. Anda boleh mencuba semula pautan dengan selamat.",
    dismiss: "Tutup pemberitahuan", cancel: "Batal", confirm: "Sahkan",
  },
} as const;

function currentUiCopy() {
  if (typeof document === "undefined") return uiCopy.en;
  const locale = document.documentElement.lang.split("-")[0];
  return locale === "ar" ? uiCopy.ar : locale === "ms" ? uiCopy.ms : uiCopy.en;
}

function getActionLabel(form: HTMLFormElement, submitter: HTMLElement | null) {
  const explicit =
    submitter?.dataset.feedbackLabel ??
    form.dataset.feedbackLabel;

  if (explicit) return explicit;

  const text = submitter?.textContent?.trim();
  if (text) return `${text}…`;

  return currentUiCopy().processing;
}

export function UxFeedbackProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [confirmation, setConfirmation] =
    useState<PendingConfirmation | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const formWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const navigationWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingForm = useRef<PendingFormState | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  const clearTimer = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);

  const notify = useCallback(
    (
      message: string,
      tone: Exclude<FeedbackTone, "loading"> = "success",
    ) => {
      clearTimer();
      setFeedback({ message, tone });
      hideTimer.current = setTimeout(() => {
        setFeedback(null);
      }, tone === "error" ? 5200 : 2600);
    },
    [clearTimer],
  );

  const showLoading = useCallback(
    (message: string) => {
      clearTimer();
      setFeedback({ message, tone: "loading" });
    },
    [clearTimer],
  );

  const clearFormPending = useCallback(() => {
    if (formWatchdog.current) {
      clearTimeout(formWatchdog.current);
      formWatchdog.current = null;
    }
    const pending = pendingForm.current;
    pending?.observer?.disconnect();
    pending?.form.removeAttribute("aria-busy");
    if (pending?.form.dataset.uxRequestPending) {
      delete pending.form.dataset.uxRequestPending;
    }
    pending?.submitter?.removeAttribute("data-ux-pending");
    pendingForm.current = null;
  }, []);

  const clearNavigationPending = useCallback(() => {
    if (navigationWatchdog.current) {
      clearTimeout(navigationWatchdog.current);
      navigationWatchdog.current = null;
    }
    delete document.documentElement.dataset.uxNavigating;
  }, []);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfirmation({ ...options, resolve });
    });
  }, []);

  const closeConfirmation = useCallback(
    (confirmed: boolean) => {
      setConfirmation((current) => {
        current?.resolve(confirmed);
        return null;
      });
    },
    [],
  );

  useEffect(() => {
    clearTimer();
    clearFormPending();
    clearNavigationPending();
    queueMicrotask(() => setFeedback(
      (current) => current?.tone === "loading" ? null : current,
    ));
  }, [pathname, clearTimer, clearFormPending, clearNavigationPending]);

  useEffect(() => {
    if (!confirmation) return;

    confirmButtonRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeConfirmation(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [confirmation, closeConfirmation]);

  useEffect(() => {
    const handleSubmit = (event: SubmitEvent) => {
      if (event.defaultPrevented) return;

      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      if (form.dataset.uxSilent === "true") return;
      if (form.dataset.uxRequestPending === "true") {
        event.preventDefault();
        return;
      }

      const submitter =
        event.submitter instanceof HTMLElement ? event.submitter : null;

      form.setAttribute("aria-busy", "true");
      form.dataset.uxRequestPending = "true";
      submitter?.setAttribute("data-ux-pending", "true");

      showLoading(getActionLabel(form, submitter));
      const pending: PendingFormState = {
        form, submitter, observer: null, frameworkPendingSeen: false,
      };
      if (submitter) {
        pending.observer = new MutationObserver(() => {
          if (submitter.getAttribute("aria-busy") === "true") {
            pending.frameworkPendingSeen = true;
          } else if (pending.frameworkPendingSeen) {
            clearFormPending();
            setFeedback(null);
          }
        });
        pending.observer.observe(submitter, {
          attributes: true,
          attributeFilter: ["aria-busy"],
        });
      }
      pendingForm.current = pending;
      formWatchdog.current = setTimeout(() => {
        setFeedback({
          message: currentUiCopy().requestUncertain,
          tone: "info",
        });
      }, 15_000);
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (event.defaultPrevented) return;

      const link = target.closest("a");
      if (
        link instanceof HTMLAnchorElement &&
        link.href &&
        link.origin === window.location.origin &&
        link.target !== "_blank" &&
        !link.hasAttribute("download") &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey
      ) {
        const destination = new URL(link.href);
        if (destination.href === window.location.href
          || (destination.pathname === window.location.pathname
            && destination.search === window.location.search)) return;
        clearNavigationPending();
        document.documentElement.dataset.uxNavigating = "true";
        showLoading(currentUiCopy().navigation);
        navigationWatchdog.current = setTimeout(() => {
          document.documentElement.dataset.uxNavigating = "uncertain";
          setFeedback({
            message: currentUiCopy().navigationUncertain,
            tone: "info",
          });
        }, 15_000);
      }
    };

    const handlePageShow = () => {
      clearFormPending();
      clearNavigationPending();
      setFeedback(null);
    };

    document.addEventListener("submit", handleSubmit);
    document.addEventListener("click", handleClick);
    window.addEventListener("pageshow", handlePageShow);

    return () => {
      document.removeEventListener("submit", handleSubmit);
      document.removeEventListener("click", handleClick);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [clearFormPending, clearNavigationPending, showLoading]);

  useEffect(() => {
    return () => {
      clearTimer();
      clearFormPending();
      clearNavigationPending();
    };
  }, [clearTimer, clearFormPending, clearNavigationPending]);

  const FeedbackIcon =
    feedback?.tone === "loading"
      ? LoaderCircle
      : feedback?.tone === "error"
        ? AlertTriangle
        : feedback?.tone === "info"
          ? Info
          : Check;

  return (
    <UxFeedbackContext.Provider value={{ notify, confirm }}>
      {children}

      <div
        className={`ux-feedback ${feedback ? "ux-feedback-visible" : ""} ${
          feedback ? `ux-feedback-${feedback.tone}` : ""
        }`}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {feedback ? (
          <>
            <span className="ux-feedback-icon">
              <FeedbackIcon
                size={20}
                className={
                  feedback.tone === "loading" ? "ux-spin" : undefined
                }
              />
            </span>
            <span>{feedback.message}</span>
            {feedback.tone !== "loading" ? (
              <button
                type="button"
                aria-label={currentUiCopy().dismiss}
                onClick={() => {
                  clearTimer();
                  setFeedback(null);
                }}
              >
                <X size={16} />
              </button>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="ux-navigation-progress" aria-hidden="true" />

      {confirmation ? (
        <div
          className="ux-confirm-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeConfirmation(false);
            }
          }}
        >
          <section
            className="ux-confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="ux-confirm-title"
            aria-describedby="ux-confirm-message"
          >
            <div
              className={`ux-confirm-symbol ${
                confirmation.destructive ? "ux-confirm-symbol-danger" : ""
              }`}
            >
              {confirmation.destructive ? (
                <AlertTriangle size={27} />
              ) : (
                <Check size={27} />
              )}
            </div>

            <div>
              <h2 id="ux-confirm-title">{confirmation.title}</h2>
              <p id="ux-confirm-message">{confirmation.message}</p>
            </div>

            <div className="ux-confirm-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => closeConfirmation(false)}
              >
                {confirmation.cancelLabel ?? currentUiCopy().cancel}
              </button>
              <button
                ref={confirmButtonRef}
                type="button"
                className={`button ${
                  confirmation.destructive
                    ? "button-danger"
                    : "button-primary"
                }`}
                onClick={() => closeConfirmation(true)}
              >
                {confirmation.confirmLabel ?? currentUiCopy().confirm}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </UxFeedbackContext.Provider>
  );
}

export function useUxFeedback() {
  const context = useContext(UxFeedbackContext);

  if (!context) {
    throw new Error(
      "useUxFeedback must be used inside UxFeedbackProvider.",
    );
  }

  return context;
}
