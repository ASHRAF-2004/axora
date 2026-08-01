# Shared UI components

Axora uses Next.js 16 App Router, React 19, and TypeScript. Its component layer is custom rather than based on a packaged component system: visual styling comes from shared class names in `src/app/globals.css`, while `lucide-react` supplies icons. This catalog is deliberately limited to reusable primitives and cross-page visual building blocks; feature-specific forms and page-sized catalog/request components are excluded.

## Brand

- File: `src/components/Brand.tsx`
- Description: Reusable Axora mark/wordmark lockup used by login, loading, and sidebar surfaces.
- Key props: `compact?: boolean` — renders the standalone mark when true.

```tsx
import Image from "next/image";

export function Brand({ compact = false }: { compact?: boolean }) {
  if (compact) return <Image src="/brand/axora-mark.svg" width={42} height={42} alt="Axora" priority />;
  return (
    <div className="brand-lockup">
      <Image src="/brand/axora-mark.svg" width={44} height={44} alt="" priority />
      <div>
        <strong>Axora</strong>
        <span>Operations</span>
      </div>
    </div>
  );
}
```

## MetricCard

- File: `src/components/MetricCard.tsx`
- Description: Dashboard/report KPI card with a Lucide icon and one of four visual tones.
- Key props: `label`, `value`, `note`, `icon`; optional `tone: "blue" | "teal" | "orange" | "navy"`.

```tsx
import type { LucideIcon } from "lucide-react";

export function MetricCard({ label, value, note, icon: Icon, tone = "blue" }: { label: string; value: string; note: string; icon: LucideIcon; tone?: "blue" | "teal" | "orange" | "navy" }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-icon"><Icon size={20} aria-hidden="true" /></div>
      <div className="metric-label">{label}</div>
      <div className="metric-value">{value}</div>
      <div className="metric-note">{note}</div>
    </article>
  );
}
```

## StatusBadge

- File: `src/components/StatusBadge.tsx`
- Description: Maps a domain status string to the shared semantic badge treatment.
- Key props: `children: string`.

```tsx
import { statusTone } from "@/lib/domain";

export function StatusBadge({ children }: { children: string }) {
  return <span className={`status-badge status-${statusTone(children)}`}>{children}</span>;
}
```

## RouteLoadingScreen

- File: `src/components/RouteLoadingScreen.tsx`
- Description: Branded, accessible full-route loading state shared by root and portal loading boundaries.
- Key props: `message?: string`.

```tsx
import { Brand } from "@/components/Brand";
import { LoaderCircle } from "lucide-react";

export function RouteLoadingScreen({
  message = "Loading Axora…",
}: {
  message?: string;
}) {
  return (
    <div className="route-loading-screen" role="status" aria-live="polite">
      <div className="route-loading-card">
        <Brand />
        <LoaderCircle className="ux-spin" size={32} />
        <strong>{message}</strong>
        <p>Please wait while Axora prepares the next screen.</p>
      </div>
    </div>
  );
}
```

## RequestPricingSummary

- File: `src/components/RequestPricingSummary.tsx`
- Description: Reusable financial breakdown for request review and approval surfaces.
- Key props: `subtotal`, `estimatedDeliveryFee`, `taxRate`, `taxAmount`, `estimatedTotal`; optional `totalLabel`.

```tsx
import { formatCurrency } from "@/lib/domain";

export function RequestPricingSummary({
  subtotal,
  estimatedDeliveryFee,
  taxRate,
  taxAmount,
  estimatedTotal,
  totalLabel = "Estimated total",
}: {
  subtotal: number;
  estimatedDeliveryFee: number;
  taxRate: number;
  taxAmount: number;
  estimatedTotal: number;
  totalLabel?: string;
}) {
  return (
    <div
      className="request-payment-summary"
      aria-label="Request pricing breakdown"
    >
      <div>
        <span>Subtotal</span>
        <strong>{formatCurrency(subtotal)}</strong>
      </div>

      <div>
        <span>Estimated delivery fee</span>
        <strong>{formatCurrency(estimatedDeliveryFee)}</strong>
      </div>

      <div>
        <span>
          Tax / SST
          {taxRate > 0 ? ` (${taxRate}%)` : ""}
        </span>
        <strong>{formatCurrency(taxAmount)}</strong>
      </div>

      <div className="request-payment-total">
        <span>{totalLabel}</span>
        <strong>{formatCurrency(estimatedTotal)}</strong>
      </div>

      <p>
        Delivery remains an estimate until Axora completes sourcing
        and confirms the final charge.
      </p>
    </div>
  );
}
```

## ProductImage

- File: `src/components/ProductImage.tsx`
- Description: Reusable product media gallery with category artwork fallback, lazy loading, paging, and optional auto-rotation controls.
- Key props: `product`; optional `showControls` and inline `style`.

```tsx
"use client";

/* eslint-disable @next/next/no-img-element */

import type { Product, ProductImageSummary } from "@/lib/types";
import { ChevronLeft, ChevronRight, Coffee, FileText, Package, Printer, Sparkles, type LucideIcon } from "lucide-react";
import type { CSSProperties, MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";

type ProductImageProduct = Pick<Product, "category" | "code" | "hasImage" | "id" | "imageAltText" | "name">;

type Artwork = {
  accent: string;
  background: string;
  foreground: string;
  Icon: LucideIcon;
};

type GalleryImage = ProductImageSummary & { legacy?: boolean };

type LoadedGallery = {
  productId: string;
  images: ProductImageSummary[];
};

function artworkFor(category: string): Artwork {
  const normalized = category.toLowerCase();

  if (normalized.includes("cleaning") || normalized.includes("hygiene")) {
    return {
      accent: "#0f9d8a",
      background: "linear-gradient(145deg, #ecfeff 0%, #ccfbf1 58%, #99f6e4 100%)",
      foreground: "#0f766e",
      Icon: Sparkles,
    };
  }

  if (normalized.includes("pantry") || normalized.includes("hospitality")) {
    return {
      accent: "#d97706",
      background: "linear-gradient(145deg, #fff7ed 0%, #ffedd5 58%, #fed7aa 100%)",
      foreground: "#b45309",
      Icon: Coffee,
    };
  }

  if (normalized.includes("print") || normalized.includes("branding") || normalized.includes("marketing")) {
    return {
      accent: "#7c3aed",
      background: "linear-gradient(145deg, #faf5ff 0%, #ede9fe 58%, #ddd6fe 100%)",
      foreground: "#6d28d9",
      Icon: Printer,
    };
  }

  if (normalized.includes("office") || normalized.includes("stationery")) {
    return {
      accent: "#2563eb",
      background: "linear-gradient(145deg, #eff6ff 0%, #dbeafe 58%, #bfdbfe 100%)",
      foreground: "#1d4ed8",
      Icon: FileText,
    };
  }

  return {
    accent: "#475569",
    background: "linear-gradient(145deg, #f8fafc 0%, #e2e8f0 58%, #cbd5e1 100%)",
    foreground: "#334155",
    Icon: Package,
  };
}

function stopCardNavigation(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.stopPropagation();
}

export function ProductImage({
  product,
  showControls = true,
  style,
}: {
  product: ProductImageProduct;
  showControls?: boolean;
  style?: CSSProperties;
}) {
  const { accent, background, foreground, Icon } = artworkFor(product.category);
  const fallbackImages = useMemo<GalleryImage[]>(() => product.hasImage ? [{
    id: "legacy-primary",
    altText: product.imageAltText || product.name,
    isPrimary: true,
    sortOrder: 0,
    legacy: true,
  }] : [], [product.hasImage, product.imageAltText, product.name]);
  const [loadedGallery, setLoadedGallery] = useState<LoadedGallery | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!product.hasImage) return;

    const controller = new AbortController();
    fetch(`/api/products/${encodeURIComponent(product.id)}/images`, {
      credentials: "same-origin",
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Gallery unavailable")))
      .then((payload: { images?: ProductImageSummary[] }) => {
        if (payload.images?.length) {
          setLoadedGallery({ productId: product.id, images: payload.images });
          setActiveIndex(0);
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [product.hasImage, product.id]);

  const images: GalleryImage[] = loadedGallery?.productId === product.id && loadedGallery.images.length
    ? loadedGallery.images
    : fallbackImages;
  const boundedIndex = images.length ? activeIndex % images.length : 0;

  useEffect(() => {
    if (!showControls || images.length < 2) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % images.length);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [images.length, showControls]);

  const current = images[boundedIndex] ?? images[0];
  const imageSource = current?.legacy
    ? `/api/products/${encodeURIComponent(product.id)}/image`
    : current
      ? `/api/products/${encodeURIComponent(product.id)}/images/${encodeURIComponent(current.id)}`
      : "";
  const controlsVisible = showControls && images.length > 1;

  return (
    <div
      style={{
        alignItems: "center",
        aspectRatio: "16 / 10",
        background,
        borderBottom: "1px solid var(--slate-200)",
        display: "flex",
        justifyContent: "center",
        overflow: "hidden",
        position: "relative",
        ...style,
      }}
    >
      {current ? (
        <img
          alt={current.altText || product.name}
          key={current.id}
          loading="lazy"
          src={imageSource}
          style={{
            background: "white",
            height: "100%",
            objectFit: "contain",
            padding: 12,
            width: "100%",
          }}
        />
      ) : (
        <div
          role="img"
          aria-label={`${product.name} product illustration`}
          style={{
            alignItems: "center",
            display: "flex",
            inset: 0,
            justifyContent: "center",
            position: "absolute",
          }}
        >
          <div
            aria-hidden="true"
            style={{
              background: "rgba(255,255,255,.68)",
              border: "1px solid rgba(255,255,255,.9)",
              borderRadius: 24,
              boxShadow: `0 18px 45px ${accent}26`,
              color: foreground,
              display: "grid",
              height: 92,
              placeItems: "center",
              transform: "rotate(-3deg)",
              width: 92,
            }}
          >
            <Icon size={43} strokeWidth={1.65} />
          </div>
        </div>
      )}

      {controlsVisible ? (
        <>
          <button
            aria-label={`Previous image for ${product.name}`}
            onClick={(event) => {
              stopCardNavigation(event);
              setActiveIndex((currentIndex) => (currentIndex - 1 + images.length) % images.length);
            }}
            style={{
              alignItems: "center",
              background: "rgba(255,255,255,.9)",
              border: "1px solid rgba(148,163,184,.5)",
              borderRadius: 999,
              display: "flex",
              height: 32,
              justifyContent: "center",
              left: 10,
              padding: 0,
              position: "absolute",
              top: "50%",
              transform: "translateY(-50%)",
              width: 32,
              zIndex: 2,
            }}
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={17} />
          </button>
          <button
            aria-label={`Next image for ${product.name}`}
            onClick={(event) => {
              stopCardNavigation(event);
              setActiveIndex((currentIndex) => (currentIndex + 1) % images.length);
            }}
            style={{
              alignItems: "center",
              background: "rgba(255,255,255,.9)",
              border: "1px solid rgba(148,163,184,.5)",
              borderRadius: 999,
              display: "flex",
              height: 32,
              justifyContent: "center",
              padding: 0,
              position: "absolute",
              right: 10,
              top: "50%",
              transform: "translateY(-50%)",
              width: 32,
              zIndex: 2,
            }}
            type="button"
          >
            <ChevronRight aria-hidden="true" size={17} />
          </button>
          <div
            aria-label={`${images.length} product images`}
            style={{
              bottom: 12,
              display: "flex",
              gap: 5,
              left: "50%",
              position: "absolute",
              transform: "translateX(-50%)",
              zIndex: 2,
            }}
          >
            {images.map((image, index) => (
              <button
                aria-label={`Show image ${index + 1} of ${images.length}`}
                key={image.id}
                onClick={(event) => {
                  stopCardNavigation(event);
                  setActiveIndex(index);
                }}
                style={{
                  background: index === boundedIndex ? foreground : "rgba(255,255,255,.9)",
                  border: "1px solid rgba(15,23,42,.25)",
                  borderRadius: 999,
                  height: 8,
                  padding: 0,
                  width: 8,
                }}
                type="button"
              />
            ))}
          </div>
        </>
      ) : null}

      <span
        className="status-badge"
        style={{
          background: "rgba(255,255,255,.84)",
          bottom: 13,
          color: foreground,
          left: 13,
          position: "absolute",
        }}
      >
        {product.category}
      </span>

      <span
        aria-hidden="true"
        style={{
          color: foreground,
          fontSize: 10,
          fontWeight: 850,
          letterSpacing: ".08em",
          opacity: 0.78,
          position: "absolute",
          right: 14,
          textTransform: "uppercase",
          top: 13,
        }}
      >
        {product.code}
      </span>
    </div>
  );
}
```

## UxFeedbackProvider / useUxFeedback

- File: `src/components/UxFeedbackProvider.tsx`
- Description: Global notification, loading, navigation-progress, and confirmation-dialog primitive used throughout the application.
- Key props: Provider accepts `children`; hook exposes `notify` and promise-based `confirm`.

```tsx
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
```
