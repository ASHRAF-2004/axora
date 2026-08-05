"use client";

import { publicVisitorCopy } from "@/lib/public-visitor-copy";
import type {
  VisitorChoice,
  VisitorCounterSnapshot,
} from "@/lib/public-visitor-counter";
import type { SupportedLocale } from "@/lib/i18n";
import {
  MoonStar,
  ShieldCheck,
  Sparkles,
  Sunrise,
} from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import styles from "./VisitorChoiceChallenge.module.css";

type Phase =
  | "loading"
  | "ready"
  | "verifying"
  | "claimed"
  | "unavailable"
  | "error";

type FailureKind =
  | "script"
  | "unsupported"
  | "timeout"
  | "request-timeout"
  | "rejected"
  | "rate-limited"
  | "unavailable"
  | "generic";

type TurnstileWidgetId = string;

type TurnstileOptions = {
  sitekey: string;
  action: "visitor_choice";
  theme: "auto";
  size: "flexible";
  execution: "execute";
  appearance: "interaction-only";
  retry: "never";
  callback: (token: string) => void;
  "error-callback": (errorCode?: string | number) => boolean;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  "unsupported-callback": () => void;
};

type TurnstileApi = {
  ready: (callback: () => void) => void;
  render: (
    container: HTMLElement,
    options: TurnstileOptions,
  ) => TurnstileWidgetId | undefined;
  execute: (widgetId: TurnstileWidgetId) => void;
  reset: (widgetId: TurnstileWidgetId) => void;
  remove: (widgetId: TurnstileWidgetId) => void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const LOCALE_TAGS: Record<SupportedLocale, string> = {
  en: "en",
  ar: "ar",
  ms: "ms-MY",
};

const VERIFICATION_TIMEOUT_MS = 18_000;
const POST_TIMEOUT_MS = 12_000;
const SNAPSHOT_TIMEOUT_MS = 10_000;

function isUsableWidgetId(value: unknown): value is TurnstileWidgetId {
  return typeof value === "string" && value.trim().length > 0;
}

function isSnapshot(value: unknown): value is VisitorCounterSnapshot {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<VisitorCounterSnapshot>;
  const counts = [
    candidate.totalCount,
    candidate.earlyBirdCount,
    candidate.nightOwlCount,
  ];
  if (!counts.every(
    (count) => Number.isSafeInteger(count) && Number(count) >= 0,
  )) {
    return false;
  }
  if (candidate.totalCount
    !== Number(candidate.earlyBirdCount) + Number(candidate.nightOwlCount)) {
    return false;
  }
  if (candidate.choice !== undefined
    && candidate.choice !== "EARLY_BIRD"
    && candidate.choice !== "NIGHT_OWL") {
    return false;
  }
  if (candidate.visitorNumber !== undefined
    && (!Number.isSafeInteger(candidate.visitorNumber)
      || candidate.visitorNumber < 1)) {
    return false;
  }
  return (candidate.choice === undefined)
    === (candidate.visitorNumber === undefined);
}

function failureKindForStatus(status: number): FailureKind {
  if (status === 403) return "rejected";
  if (status === 429) return "rate-limited";
  if (status === 503) return "unavailable";
  return "generic";
}

function toHex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function platformFamily() {
  const navigatorWithPlatform = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const source = (
    navigatorWithPlatform.userAgentData?.platform
    ?? navigator.platform
    ?? navigator.userAgent
    ?? ""
  ).toLowerCase();
  if (/(iphone|ipad|ipod|ios)/.test(source)) return "ios";
  if (/android/.test(source)) return "android";
  if (/windows|win32|win64/.test(source)) return "windows";
  if (/mac|darwin/.test(source)) return "macos";
  if (/linux|x11/.test(source)) return "linux";
  return "other";
}

function concurrencyBucket(value: number | undefined) {
  if (!value || value < 1) return 0;
  if (value <= 2) return 2;
  if (value <= 4) return 4;
  if (value <= 8) return 8;
  if (value <= 16) return 16;
  return 32;
}

function roundedDimension(value: number) {
  return Math.round(value / 10) * 10;
}

async function buildLimitedClientSignal() {
  if (!globalThis.crypto?.subtle) return undefined;
  const longSide = roundedDimension(Math.max(screen.width, screen.height));
  const shortSide = roundedDimension(Math.min(screen.width, screen.height));
  const signal = JSON.stringify({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? "",
    languages: [...(navigator.languages ?? [navigator.language])]
      .slice(0, 4)
      .map((language) => language.toLowerCase()),
    platform: platformFamily(),
    concurrency: concurrencyBucket(navigator.hardwareConcurrency),
    touch: navigator.maxTouchPoints > 0,
    longSide,
    shortSide,
    colorDepth: screen.colorDepth ?? 0,
    pixelRatio:
      Math.round((window.devicePixelRatio || 1) * 4) / 4,
  });
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(signal),
  );
  return toHex(digest);
}

export function visitorChoicePercentages(snapshot: VisitorCounterSnapshot) {
  if (snapshot.totalCount === 0) {
    return { early: 50, night: 50 };
  }
  const early = Math.round(
    (snapshot.earlyBirdCount / snapshot.totalCount) * 100,
  );
  return {
    early,
    night: 100 - early,
  };
}

export function VisitorChoiceChallenge({
  locale,
  siteKey,
}: {
  locale: SupportedLocale;
  siteKey?: string;
}) {
  const copy = publicVisitorCopy[locale];
  const localeTag = LOCALE_TAGS[locale];
  const validSiteKey = Boolean(
    siteKey && /^[A-Za-z0-9_-]{10,100}$/.test(siteKey),
  );
  const initialSnapshot: VisitorCounterSnapshot = {
    totalCount: 0,
    earlyBirdCount: 0,
    nightOwlCount: 0,
  };
  const [snapshot, setSnapshot] = useState<VisitorCounterSnapshot>(
    initialSnapshot,
  );
  const [phase, setPhase] = useState<Phase>("loading");
  const [failureKind, setFailureKind] = useState<FailureKind | null>(null);
  const [hovered, setHovered] = useState<VisitorChoice | null>(null);
  const [pendingChoice, setPendingChoice] = useState<VisitorChoice | null>(
    null,
  );
  const widgetContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<TurnstileWidgetId | null>(null);
  const pendingChoiceRef = useRef<VisitorChoice | null>(null);
  const clientSignalRef = useRef<string | undefined>(undefined);
  const challengeRunningRef = useRef(false);
  const postSubmittedRef = useRef(false);
  const initializingRef = useRef(false);
  const scriptReadyRef = useRef(false);
  const scriptFailedRef = useRef(false);
  const widgetCleanupFailedRef = useRef(false);
  const mountedRef = useRef(true);
  const phaseRef = useRef<Phase>("loading");
  const snapshotRef = useRef<VisitorCounterSnapshot>(initialSnapshot);
  const activeAttemptRef = useRef(0);
  const verificationTimerRef = useRef<number | null>(null);
  const postTimerRef = useRef<number | null>(null);
  const postControllerRef = useRef<AbortController | null>(null);
  const snapshotTimerRef = useRef<number | null>(null);
  const snapshotControllerRef = useRef<AbortController | null>(null);

  const percentages = useMemo(
    () => visitorChoicePercentages(snapshot),
    [snapshot],
  );
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(localeTag),
    [localeTag],
  );

  const transitionTo = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const updateSnapshot = useCallback((next: VisitorCounterSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  const clearVerificationTimer = useCallback(() => {
    if (verificationTimerRef.current !== null) {
      window.clearTimeout(verificationTimerRef.current);
      verificationTimerRef.current = null;
    }
  }, []);

  const clearPostRequest = useCallback((abort: boolean) => {
    if (postTimerRef.current !== null) {
      window.clearTimeout(postTimerRef.current);
      postTimerRef.current = null;
    }
    const controller = postControllerRef.current;
    postControllerRef.current = null;
    if (abort && controller && !controller.signal.aborted) {
      try {
        controller.abort();
      } catch {
        // Abort failures must not leave the UI in a pending state.
      }
    }
  }, []);

  const clearSnapshotRequest = useCallback((abort: boolean) => {
    if (snapshotTimerRef.current !== null) {
      window.clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
    const controller = snapshotControllerRef.current;
    snapshotControllerRef.current = null;
    if (abort && controller && !controller.signal.aborted) {
      try {
        controller.abort();
      } catch {
        // Snapshot recovery will surface a retryable localized error.
      }
    }
  }, []);

  const safeRemoveWidget = useCallback(() => {
    const widgetId = widgetIdRef.current;
    widgetIdRef.current = null;
    initializingRef.current = false;
    challengeRunningRef.current = false;
    if (!widgetId) return !widgetCleanupFailedRef.current;

    const api = window.turnstile;
    if (!api) {
      widgetCleanupFailedRef.current = true;
      return false;
    }
    try {
      api.remove(widgetId);
      widgetCleanupFailedRef.current = false;
      return true;
    } catch {
      widgetCleanupFailedRef.current = true;
      return false;
    }
  }, []);

  const safeResetWidget = useCallback(() => {
    const widgetId = widgetIdRef.current;
    const api = window.turnstile;
    challengeRunningRef.current = false;
    if (!widgetId || !api) return false;
    try {
      api.reset(widgetId);
      return true;
    } catch {
      try {
        api.remove(widgetId);
        widgetCleanupFailedRef.current = false;
      } catch {
        widgetCleanupFailedRef.current = true;
      }
      widgetIdRef.current = null;
      return false;
    }
  }, []);

  const failChallenge = useCallback((
    kind: FailureKind,
    options: { attemptId?: number; force?: boolean } = {},
  ) => {
    if (!mountedRef.current || snapshotRef.current.choice) return;
    if (options.attemptId !== undefined
      && options.attemptId !== activeAttemptRef.current) {
      return;
    }
    if (!options.force && phaseRef.current !== "verifying") return;

    activeAttemptRef.current += 1;
    pendingChoiceRef.current = null;
    setPendingChoice(null);
    postSubmittedRef.current = false;
    clearVerificationTimer();
    clearPostRequest(true);
    if (kind === "script") {
      scriptFailedRef.current = true;
    }
    setFailureKind(kind);
    transitionTo("error");
    safeResetWidget();
  }, [
    clearPostRequest,
    clearVerificationTimer,
    safeResetWidget,
    transitionTo,
  ]);

  const startVerificationTimer = useCallback((attemptId: number) => {
    clearVerificationTimer();
    verificationTimerRef.current = window.setTimeout(() => {
      failChallenge("timeout", { attemptId });
    }, VERIFICATION_TIMEOUT_MS);
  }, [clearVerificationTimer, failChallenge]);

  const loadSnapshot = useCallback(async () => {
    clearSnapshotRequest(true);
    const controller = new AbortController();
    snapshotControllerRef.current = controller;
    snapshotTimerRef.current = window.setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // The caller converts this into a localized retryable state.
      }
    }, SNAPSHOT_TIMEOUT_MS);

    try {
      const signal = clientSignalRef.current;
      const response = await fetch("/api/public/visitor-choice", {
        headers: signal
          ? { "X-Axora-Visitor-Signal": signal }
          : undefined,
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });
      const payload: unknown = await response.json();
      if (!response.ok || !isSnapshot(payload)) {
        throw new Error("snapshot_failed");
      }
      return payload;
    } finally {
      if (snapshotControllerRef.current === controller) {
        clearSnapshotRequest(false);
      }
    }
  }, [clearSnapshotRequest]);

  const submitClaim = useCallback(async (turnstileToken: string) => {
    const attemptId = activeAttemptRef.current;
    const choice = pendingChoiceRef.current;
    if (phaseRef.current !== "verifying" || !choice || !turnstileToken) {
      if (phaseRef.current === "verifying") {
        failChallenge("generic", { attemptId });
      }
      return;
    }
    if (postSubmittedRef.current) {
      return;
    }
    postSubmittedRef.current = true;

    clearPostRequest(true);
    const controller = new AbortController();
    postControllerRef.current = controller;
    postTimerRef.current = window.setTimeout(() => {
      try {
        controller.abort();
      } catch {
        // The catch path below converts this to a retryable request timeout.
      }
    }, POST_TIMEOUT_MS);

    try {
      const response = await fetch("/api/public/visitor-choice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
        body: JSON.stringify({
          choice,
          locale,
          turnstileToken,
          ...(clientSignalRef.current
            ? { clientSignal: clientSignalRef.current }
            : {}),
        }),
      });
      const payload: unknown = await response.json();
      if (attemptId !== activeAttemptRef.current || !mountedRef.current) {
        return;
      }
      if (!response.ok) {
        failChallenge(failureKindForStatus(response.status), { attemptId });
        return;
      }
      if (!isSnapshot(payload) || !payload.choice || !payload.visitorNumber) {
        failChallenge("generic", { attemptId });
        return;
      }

      clearPostRequest(false);
      clearVerificationTimer();
      challengeRunningRef.current = false;
      postSubmittedRef.current = false;
      pendingChoiceRef.current = null;
      setPendingChoice(null);
      setFailureKind(null);
      updateSnapshot(payload);
      transitionTo("claimed");
    } catch {
      if (attemptId !== activeAttemptRef.current || !mountedRef.current) {
        return;
      }
      failChallenge(
        controller.signal.aborted ? "request-timeout" : "generic",
        { attemptId },
      );
    }
  }, [
    clearPostRequest,
    clearVerificationTimer,
    failChallenge,
    locale,
    transitionTo,
    updateSnapshot,
  ]);

  const executePendingChallenge = useCallback((attemptId: number) => {
    if (attemptId !== activeAttemptRef.current
      || phaseRef.current !== "verifying"
      || !pendingChoiceRef.current) {
      return false;
    }
    if (challengeRunningRef.current || postSubmittedRef.current) {
      return true;
    }

    const api = window.turnstile;
    const widgetId = widgetIdRef.current;
    if (!api || !isUsableWidgetId(widgetId)) {
      if (initializingRef.current || !scriptReadyRef.current) {
        // The bounded verification watchdog owns this in-flight wait.
        return false;
      }
      failChallenge("generic", { attemptId });
      return false;
    }

    try {
      challengeRunningRef.current = true;
      api.execute(widgetId);
      return true;
    } catch {
      challengeRunningRef.current = false;
      failChallenge("generic", { attemptId });
      return false;
    }
  }, [failChallenge]);

  const initializeTurnstile = useCallback(() => {
    if (!validSiteKey || !siteKey || !widgetContainerRef.current) {
      if (phaseRef.current === "verifying") {
        failChallenge("generic", {
          attemptId: activeAttemptRef.current,
        });
      }
      return false;
    }
    if (isUsableWidgetId(widgetIdRef.current)) {
      if (phaseRef.current === "verifying") {
        executePendingChallenge(activeAttemptRef.current);
      }
      return true;
    }
    if (initializingRef.current) return true;

    const api = window.turnstile;
    if (!api) {
      if (scriptReadyRef.current || scriptFailedRef.current) {
        failChallenge("script", {
          attemptId: activeAttemptRef.current,
          force: phaseRef.current !== "verifying",
        });
      }
      return false;
    }

    scriptReadyRef.current = true;
    scriptFailedRef.current = false;
    initializingRef.current = true;

    const renderOnce = () => {
      if (!mountedRef.current || !initializingRef.current) {
        return isUsableWidgetId(widgetIdRef.current);
      }
      if (isUsableWidgetId(widgetIdRef.current)) {
        initializingRef.current = false;
        return true;
      }

      const currentApi = window.turnstile;
      const container = widgetContainerRef.current;
      if (!currentApi || !container) {
        initializingRef.current = false;
        failChallenge("script", { force: true });
        return false;
      }

      const reportWidgetFailure = (kind: FailureKind) => {
        const currentPhase = phaseRef.current;
        if (currentPhase === "verifying") {
          failChallenge(kind, {
            attemptId: activeAttemptRef.current,
          });
        } else if (currentPhase === "loading" || currentPhase === "ready") {
          failChallenge(kind, { force: true });
        }
      };

      let widgetId: unknown;
      try {
        widgetId = currentApi.render(container, {
          sitekey: siteKey,
          action: "visitor_choice",
          theme: "auto",
          size: "flexible",
          execution: "execute",
          appearance: "interaction-only",
          retry: "never",
          callback: (token) => {
            void submitClaim(token);
          },
          "error-callback": () => {
            reportWidgetFailure("generic");
            return true;
          },
          "expired-callback": () => {
            reportWidgetFailure("generic");
          },
          "timeout-callback": () => {
            reportWidgetFailure("timeout");
          },
          "unsupported-callback": () => {
            reportWidgetFailure("unsupported");
          },
        });
      } catch {
        initializingRef.current = false;
        widgetCleanupFailedRef.current = true;
        failChallenge("script", { force: true });
        return false;
      }

      if (!isUsableWidgetId(widgetId)) {
        initializingRef.current = false;
        widgetCleanupFailedRef.current = true;
        failChallenge("script", { force: true });
        return false;
      }

      widgetIdRef.current = widgetId;
      widgetCleanupFailedRef.current = false;
      initializingRef.current = false;
      if (phaseRef.current === "verifying") {
        executePendingChallenge(activeAttemptRef.current);
      }
      return true;
    };

    try {
      api.ready(() => {
        renderOnce();
      });
    } catch {
      // Next Script's load callbacks still permit a direct explicit render.
    }

    // Next Script invokes this only after api.js has loaded. Render directly
    // as well as registering ready(): some blocked or partially initialized
    // clients expose the API but never invoke ready callbacks.
    return renderOnce();
  }, [
    executePendingChallenge,
    failChallenge,
    siteKey,
    submitClaim,
    validSiteKey,
  ]);

  const handleScriptReady = useCallback(() => {
    scriptReadyRef.current = Boolean(window.turnstile);
    scriptFailedRef.current = !window.turnstile;
    if (!window.turnstile) {
      failChallenge("script", { force: true });
      return;
    }
    initializeTurnstile();
  }, [failChallenge, initializeTurnstile]);

  const handleScriptError = useCallback(() => {
    scriptReadyRef.current = false;
    scriptFailedRef.current = true;
    initializingRef.current = false;
    safeRemoveWidget();
    failChallenge("script", { force: true });
  }, [failChallenge, safeRemoveWidget]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const signal = await buildLimitedClientSignal();
        if (cancelled) return;
        clientSignalRef.current = signal;
        const payload = await loadSnapshot();
        if (cancelled) return;
        updateSnapshot(payload);
        setFailureKind(null);
        if (payload.choice) {
          transitionTo("claimed");
        } else if (!validSiteKey) {
          transitionTo("unavailable");
        } else if (!scriptFailedRef.current) {
          transitionTo("ready");
          initializeTurnstile();
        }
      } catch {
        if (!cancelled) transitionTo("unavailable");
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      activeAttemptRef.current += 1;
      clearVerificationTimer();
      clearPostRequest(true);
      clearSnapshotRequest(true);
      safeRemoveWidget();
    };
  }, [
    clearPostRequest,
    clearSnapshotRequest,
    clearVerificationTimer,
    initializeTurnstile,
    loadSnapshot,
    safeRemoveWidget,
    transitionTo,
    updateSnapshot,
    validSiteKey,
  ]);

  const choose = useCallback((choice: VisitorChoice) => {
    if (snapshotRef.current.choice
      || phaseRef.current !== "ready"
      || !validSiteKey) {
      return;
    }

    const attemptId = activeAttemptRef.current + 1;
    activeAttemptRef.current = attemptId;
    pendingChoiceRef.current = choice;
    setPendingChoice(choice);
    postSubmittedRef.current = false;
    challengeRunningRef.current = false;
    setFailureKind(null);
    transitionTo("verifying");
    startVerificationTimer(attemptId);
    initializeTurnstile();
    executePendingChallenge(attemptId);
  }, [
    executePendingChallenge,
    initializeTurnstile,
    startVerificationTimer,
    transitionTo,
    validSiteKey,
  ]);

  const retry = useCallback(() => {
    if (snapshotRef.current.choice || phaseRef.current === "loading") return;

    const retryId = activeAttemptRef.current + 1;
    activeAttemptRef.current = retryId;
    pendingChoiceRef.current = null;
    setPendingChoice(null);
    postSubmittedRef.current = false;
    challengeRunningRef.current = false;
    clearVerificationTimer();
    clearPostRequest(true);
    setFailureKind(null);
    transitionTo("loading");
    const widgetRemoved = safeRemoveWidget();

    void (async () => {
      try {
        const payload = await loadSnapshot();
        if (!mountedRef.current || retryId !== activeAttemptRef.current) {
          return;
        }
        updateSnapshot(payload);
        if (payload.choice) {
          transitionTo("claimed");
          return;
        }
        if (!validSiteKey) {
          transitionTo("unavailable");
          return;
        }
        if (!widgetRemoved
          || widgetCleanupFailedRef.current
          || !window.turnstile) {
          window.location.reload();
          return;
        }

        scriptReadyRef.current = true;
        scriptFailedRef.current = false;
        transitionTo("ready");
        initializeTurnstile();
      } catch {
        if (!mountedRef.current || retryId !== activeAttemptRef.current) {
          return;
        }
        setFailureKind("unavailable");
        transitionTo("error");
      }
    })();
  }, [
    clearPostRequest,
    clearVerificationTimer,
    initializeTurnstile,
    loadSnapshot,
    safeRemoveWidget,
    transitionTo,
    updateSnapshot,
    validSiteKey,
  ]);

  const claimedChoice = snapshot.choice;
  const failureMessage = failureKind === "script"
    ? copy.scriptError
    : failureKind === "unsupported"
      ? copy.unsupported
      : failureKind === "timeout"
        ? copy.timeout
        : failureKind === "request-timeout"
          ? copy.requestTimeout
          : failureKind === "rejected"
            ? copy.rejected
            : failureKind === "rate-limited"
              ? copy.rateLimited
              : failureKind === "unavailable"
                ? copy.unavailable
                : copy.error;
  const statusMessage = phase === "loading"
    ? copy.loading
    : phase === "verifying"
      ? copy.verifying
      : phase === "unavailable"
        ? copy.unavailable
        : phase === "error"
          ? failureMessage
          : claimedChoice && snapshot.visitorNumber
            ? `${copy.result(claimedChoice, snapshot.visitorNumber)} ${copy.alreadyClaimed}`
            : "";

  return (
    <section
      className={styles.section}
      aria-labelledby="visitor-choice-title"
      data-hovered={hovered ?? "none"}
      data-claimed={claimedChoice ?? "none"}
      data-phase={phase}
    >
      {validSiteKey ? (
        <Script
          id="axora-visitor-turnstile"
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={handleScriptReady}
          onReady={handleScriptReady}
          onError={handleScriptError}
        />
      ) : null}

      <div className={styles.glow} aria-hidden="true" />
      <div className={styles.header}>
        <p className={styles.eyebrow}>
          <Sparkles size={16} aria-hidden="true" />
          {copy.eyebrow}
        </p>
        <h2 id="visitor-choice-title">{copy.title}</h2>
        <p>{copy.body}</p>
        <div className={styles.total} aria-live="polite">
          <strong>{numberFormatter.format(snapshot.totalCount)}</strong>
          <span>{copy.totalLabel}</span>
        </div>
      </div>

      <div
        className={styles.arena}
        role="group"
        aria-label={copy.groupLabel}
      >
        <button
          type="button"
          className={`${styles.side} ${styles.earlySide}`}
          aria-label={copy.chooseEarly}
          aria-pressed={claimedChoice === "EARLY_BIRD"}
          disabled={Boolean(claimedChoice)
            || phase !== "ready"
            || !validSiteKey}
          onPointerEnter={() => setHovered("EARLY_BIRD")}
          onPointerLeave={() => setHovered(null)}
          onFocus={() => setHovered("EARLY_BIRD")}
          onBlur={() => setHovered(null)}
          onClick={() => choose("EARLY_BIRD")}
        >
          <span className={styles.iconDisc} aria-hidden="true">
            <Sunrise size={34} />
          </span>
          <span className={styles.sideCopy}>
            <strong>{copy.earlyTitle}</strong>
            <small>{copy.earlyDescription}</small>
          </span>
          <span className={styles.sideCount}>
            {numberFormatter.format(snapshot.earlyBirdCount)}
          </span>
          {pendingChoice === "EARLY_BIRD" ? (
            <span className={styles.pendingPulse} aria-hidden="true" />
          ) : null}
        </button>

        <div className={styles.versus} aria-hidden="true">
          <span>VS</span>
        </div>

        <button
          type="button"
          className={`${styles.side} ${styles.nightSide}`}
          aria-label={copy.chooseNight}
          aria-pressed={claimedChoice === "NIGHT_OWL"}
          disabled={Boolean(claimedChoice)
            || phase !== "ready"
            || !validSiteKey}
          onPointerEnter={() => setHovered("NIGHT_OWL")}
          onPointerLeave={() => setHovered(null)}
          onFocus={() => setHovered("NIGHT_OWL")}
          onBlur={() => setHovered(null)}
          onClick={() => choose("NIGHT_OWL")}
        >
          <span className={styles.iconDisc} aria-hidden="true">
            <MoonStar size={34} />
          </span>
          <span className={styles.sideCopy}>
            <strong>{copy.nightTitle}</strong>
            <small>{copy.nightDescription}</small>
          </span>
          <span className={styles.sideCount}>
            {numberFormatter.format(snapshot.nightOwlCount)}
          </span>
          {pendingChoice === "NIGHT_OWL" ? (
            <span className={styles.pendingPulse} aria-hidden="true" />
          ) : null}
        </button>

        {claimedChoice ? (
          <div className={styles.lockedLayer} aria-hidden="true">
            <div className={styles.confetti}>
              {Array.from({ length: 12 }, (_, index) => (
                <i key={index} />
              ))}
            </div>
            <span className={styles.stamp}>{copy.locked}</span>
          </div>
        ) : null}
      </div>

      <div className={styles.tally}>
        <div className={styles.tallyLabels}>
          <span>
            {copy.earlyCountLabel}
            <strong>{percentages.early}%</strong>
          </span>
          <span>
            <strong>{percentages.night}%</strong>
            {copy.nightCountLabel}
          </span>
        </div>
        <div className={styles.tallyTrack} aria-hidden="true">
          <i style={{ width: `${percentages.early}%` }} />
          <b style={{ width: `${percentages.night}%` }} />
        </div>
      </div>

      <div
        className={styles.status}
        role={phase === "error" ? "alert" : "status"}
        aria-live="polite"
      >
        {statusMessage ? <p>{statusMessage}</p> : null}
        {phase === "error" ? (
          <button
            type="button"
            onClick={retry}
          >
            {copy.retry}
          </button>
        ) : null}
      </div>

      <div
        ref={widgetContainerRef}
        className={styles.turnstile}
      />

      <p className={styles.privacyNote}>
        <ShieldCheck size={17} aria-hidden="true" />
        <span>
          <strong>{copy.protectedBy}.</strong> {copy.privacy}{" "}
          <Link href={`/${locale}/privacy`}>{copy.privacyLink}</Link>
        </span>
      </p>
    </section>
  );
}
