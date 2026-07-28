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

type UxFeedbackContextValue = {
  notify: (message: string, tone?: Exclude<FeedbackTone, "loading">) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
};

const UxFeedbackContext = createContext<UxFeedbackContextValue | null>(null);

function getActionLabel(form: HTMLFormElement, submitter: HTMLElement | null) {
  const explicit =
    submitter?.dataset.feedbackLabel ??
    form.dataset.feedbackLabel;

  if (explicit) return explicit;

  const text = submitter?.textContent?.trim();
  if (text) return `${text}…`;

  return "Processing your request…";
}

export function UxFeedbackProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [feedback, setFeedback] = useState<FeedbackState>(null);
  const [confirmation, setConfirmation] =
    useState<PendingConfirmation | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
      hideTimer.current = setTimeout(() => {
        setFeedback(null);
      }, 12000);
    },
    [clearTimer],
  );

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
    queueMicrotask(() => setFeedback(null));
  }, [pathname, clearTimer]);

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

      const submitter =
        event.submitter instanceof HTMLElement ? event.submitter : null;

      form.setAttribute("aria-busy", "true");
      submitter?.setAttribute("data-ux-pending", "true");

      showLoading(getActionLabel(form, submitter));

      setTimeout(() => {
        form.removeAttribute("aria-busy");
        submitter?.removeAttribute("data-ux-pending");
      }, 12000);
    };

    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

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
        document.documentElement.dataset.uxNavigating = "true";
        setTimeout(() => {
          delete document.documentElement.dataset.uxNavigating;
        }, 8000);
      }

      const button = target.closest("button");
      if (
        button instanceof HTMLButtonElement &&
        button.type === "button" &&
        button.dataset.uxSilent !== "true" &&
        button.classList.contains("button")
      ) {
        notify(
          button.dataset.feedbackLabel ?? "Action received",
          "info",
        );
      }
    };

    document.addEventListener("submit", handleSubmit);
    document.addEventListener("click", handleClick);

    return () => {
      document.removeEventListener("submit", handleSubmit);
      document.removeEventListener("click", handleClick);
    };
  }, [notify, showLoading]);

  useEffect(() => {
    return () => clearTimer();
  }, [clearTimer]);

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
                aria-label="Dismiss notification"
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
                {confirmation.cancelLabel ?? "Cancel"}
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
                {confirmation.confirmLabel ?? "Confirm"}
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
