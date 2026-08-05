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
  | "recovering"
  | "claimed"
  | "unavailable"
  | "error";

type FailureReason =
  | "generic"
  | "script"
  | "unsupported"
  | "verification-timeout"
  | "request-timeout"
  | "rejected"
  | "rate-limited"
  | "service-unavailable";

type ScriptState = "loading" | "ready" | "error";

type TurnstileWidgetId = string;

type TurnstileOptions = {
  sitekey: string;
  action: "visitor_choice";
  theme: "auto";
  size: "flexible";
  execution: "execute";
  appearance: "interaction-only";
  callback: (token: string) => void;
  "error-callback": () => boolean;
  "expired-callback": () => void;
  "timeout-callback": () => void;
  "unsupported-callback": () => void;
};

type TurnstileApi = {
  ready: (callback: () => void) => void;
  render: (
    container: HTMLElement,
    options: TurnstileOptions,
  ) => unknown;
  execute: (widgetId: TurnstileWidgetId) => void;
  reset: (widgetId: TurnstileWidgetId) => void;
  remove: (widgetId: TurnstileWidgetId) => void;
};

declare global {
  interface Window {
    turnstile?: unknown;
  }
}

const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const VERIFICATION_TIMEOUT_MS = 18_000;
const POST_TIMEOUT_MS = 12_000;
const SNAPSHOT_TIMEOUT_MS = 12_000;

const LOCALE_TAGS: Record<SupportedLocale, string> = {
  en: "en",
  ar: "ar",
  ms: "ms-MY",
};

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

function isTurnstileApi(value: unknown): value is TurnstileApi {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TurnstileApi>;
  return typeof candidate.ready === "function"
    && typeof candidate.render === "function"
    && typeof candidate.execute === "function"
    && typeof candidate.reset === "function"
    && typeof candidate.remove === "function";
}

function currentTurnstileApi() {
  return isTurnstileApi(window.turnstile) ? window.turnstile : null;
}

function isUsableWidgetId(value: unknown): value is TurnstileWidgetId {
  return typeof value === "string" && value.trim().length > 0;
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

function abortError(error: unknown) {
  if (error instanceof DOMException) return error.name === "AbortError";
  if (typeof error !== "object" || error === null) return false;
  return "name" in error && error.name === "AbortError";
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
  const verifiedSiteKey = siteKey?.trim();
  const validSiteKey = Boolean(
    verifiedSiteKey && /^[A-Za-z0-9_-]{10,100}$/.test(verifiedSiteKey),
  );
  const [snapshot, setSnapshot] = useState<VisitorCounterSnapshot>({
    totalCount: 0,
    earlyBirdCount: 0,
    nightOwlCount: 0,
  });
  const [phase, setPhase] = useState<Phase>("loading");
  const [failureReason, setFailureReason] = useState<FailureReason>("generic");
  const [hovered, setHovered] = useState<VisitorChoice | null>(null);
  const [pendingChoice, setPendingChoice] = useState<VisitorChoice | null>(
    null,
  );
  const [scriptGeneration, setScriptGeneration] = useState(0);

  const widgetContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<TurnstileWidgetId | null>(null);
  const pendingChoiceRef = useRef<VisitorChoice | null>(null);
  const clientSignalRef = useRef<string | undefined>(undefined);
  const challengeRunningRef = useRef(false);
  const submissionRunningRef = useRef(false);
  const retryRunningRef = useRef(false);
  const mountedRef = useRef(true);
  const claimCompletedRef = useRef(false);
  const scriptStateRef = useRef<ScriptState>("loading");
  const scriptReloadPendingRef = useRef(false);
  const activeAttemptRef = useRef<number | null>(null);
  const attemptSequenceRef = useRef(0);
  const preparingAttemptRef = useRef<number | null>(null);
  const waitingForScriptAttemptRef = useRef<number | null>(null);
  const verificationTimerRef = useRef<number | null>(null);
  const postControllerRef = useRef<AbortController | null>(null);
  const postTimerRef = useRef<number | null>(null);
  const snapshotControllerRef = useRef<AbortController | null>(null);
  const snapshotTimerRef = useRef<number | null>(null);

  const percentages = useMemo(
    () => visitorChoicePercentages(snapshot),
    [snapshot],
  );
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(localeTag),
    [localeTag],
  );

  const clearVerificationTimeout = useCallback(() => {
    if (verificationTimerRef.current !== null) {
      window.clearTimeout(verificationTimerRef.current);
      verificationTimerRef.current = null;
    }
  }, []);

  const abortPost = useCallback(() => {
    if (postTimerRef.current !== null) {
      window.clearTimeout(postTimerRef.current);
      postTimerRef.current = null;
    }
    postControllerRef.current?.abort();
    postControllerRef.current = null;
    submissionRunningRef.current = false;
  }, []);

  const abortSnapshot = useCallback(() => {
    if (snapshotTimerRef.current !== null) {
      window.clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
    snapshotControllerRef.current?.abort();
    snapshotControllerRef.current = null;
  }, []);

  const safeResetWidget = useCallback(() => {
    challengeRunningRef.current = false;
    const widgetId = widgetIdRef.current;
    if (!widgetId) return;
    const api = currentTurnstileApi();
    if (!api) return;
    try {
      api.reset(widgetId);
    } catch {
      // A failed reset must never trap the interface in a busy state.
    }
  }, []);

  const safeRemoveWidget = useCallback(() => {
    challengeRunningRef.current = false;
    const widgetId = widgetIdRef.current;
    widgetIdRef.current = null;
    if (widgetId) {
      const api = currentTurnstileApi();
      if (api) {
        try {
          api.remove(widgetId);
        } catch {
          // The container is cleared below even if the vendor teardown fails.
        }
      }
    }
    try {
      widgetContainerRef.current?.replaceChildren();
    } catch {
      // Ignore detached or browser-managed container teardown failures.
    }
  }, []);

  const retireWidget = useCallback(() => {
    safeResetWidget();
    safeRemoveWidget();
  }, [safeRemoveWidget, safeResetWidget]);

  const failAttempt = useCallback((
    reason: FailureReason,
    attempt?: number,
  ) => {
    if (!mountedRef.current) return;
    if (attempt !== undefined && activeAttemptRef.current !== attempt) return;

    clearVerificationTimeout();
    abortPost();
    preparingAttemptRef.current = null;
    waitingForScriptAttemptRef.current = null;
    activeAttemptRef.current = null;
    safeResetWidget();
    if (reason === "script") {
      scriptReloadPendingRef.current = false;
      scriptStateRef.current = "error";
    }
    if (claimCompletedRef.current) return;
    setFailureReason(reason);
    setPhase(reason === "service-unavailable" ? "unavailable" : "error");
  }, [abortPost, clearVerificationTimeout, safeResetWidget]);

  const fetchSnapshot = useCallback(async () => {
    abortSnapshot();
    const controller = new AbortController();
    snapshotControllerRef.current = controller;
    snapshotTimerRef.current = window.setTimeout(
      () => controller.abort(),
      SNAPSHOT_TIMEOUT_MS,
    );

    try {
      const response = await fetch("/api/public/visitor-choice", {
        headers: clientSignalRef.current
          ? { "X-Axora-Visitor-Signal": clientSignalRef.current }
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
        if (snapshotTimerRef.current !== null) {
          window.clearTimeout(snapshotTimerRef.current);
          snapshotTimerRef.current = null;
        }
        snapshotControllerRef.current = null;
      }
    }
  }, [abortSnapshot]);

  const submitClaim = useCallback(async (
    turnstileToken: string,
    attempt: number,
  ) => {
    const choice = pendingChoiceRef.current;
    if (activeAttemptRef.current !== attempt
      || submissionRunningRef.current) {
      return;
    }
    if (!choice || !turnstileToken) {
      failAttempt("generic", attempt);
      return;
    }

    clearVerificationTimeout();
    challengeRunningRef.current = false;
    submissionRunningRef.current = true;
    const controller = new AbortController();
    postControllerRef.current = controller;
    postTimerRef.current = window.setTimeout(
      () => controller.abort(),
      POST_TIMEOUT_MS,
    );

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
      const payload: unknown = await response.json().catch(() => null);

      if (activeAttemptRef.current !== attempt) return;
      if (response.status === 403) {
        failAttempt("rejected", attempt);
        return;
      }
      if (response.status === 429) {
        failAttempt("rate-limited", attempt);
        return;
      }
      if (response.status === 503) {
        failAttempt("service-unavailable", attempt);
        return;
      }
      if (!response.ok || !isSnapshot(payload)
        || !payload.choice || !payload.visitorNumber) {
        failAttempt("generic", attempt);
        return;
      }
      if (!mountedRef.current) return;

      if (postTimerRef.current !== null) {
        window.clearTimeout(postTimerRef.current);
        postTimerRef.current = null;
      }
      postControllerRef.current = null;
      submissionRunningRef.current = false;
      activeAttemptRef.current = null;
      pendingChoiceRef.current = null;
      setPendingChoice(null);
      claimCompletedRef.current = true;
      setSnapshot(payload);
      setFailureReason("generic");
      setPhase("claimed");
      retireWidget();
    } catch (error) {
      if (activeAttemptRef.current !== attempt) return;
      failAttempt(abortError(error) ? "request-timeout" : "generic", attempt);
    }
  }, [
    clearVerificationTimeout,
    failAttempt,
    locale,
    retireWidget,
  ]);

  const prepareAndExecute = useCallback((attempt: number) => {
    if (!mountedRef.current || activeAttemptRef.current !== attempt) return;
    if (challengeRunningRef.current || submissionRunningRef.current) return;
    if (preparingAttemptRef.current === attempt) return;

    if (scriptReloadPendingRef.current) {
      waitingForScriptAttemptRef.current = attempt;
      return;
    }

    const api = currentTurnstileApi();
    if (!api) {
      if (scriptStateRef.current === "loading") {
        waitingForScriptAttemptRef.current = attempt;
        return;
      }
      failAttempt("script", attempt);
      return;
    }
    if (!verifiedSiteKey || !widgetContainerRef.current) {
      failAttempt("script", attempt);
      return;
    }

    preparingAttemptRef.current = attempt;
    try {
      api.ready(() => {
        if (!mountedRef.current || activeAttemptRef.current !== attempt) {
          return;
        }
        preparingAttemptRef.current = null;
        const readyApi = currentTurnstileApi();
        const container = widgetContainerRef.current;
        if (!readyApi || !container) {
          failAttempt("script", attempt);
          return;
        }

        safeRemoveWidget();
        let renderedWidgetId: unknown;
        try {
          renderedWidgetId = readyApi.render(container, {
            sitekey: verifiedSiteKey,
            action: "visitor_choice",
            theme: "auto",
            size: "flexible",
            execution: "execute",
            appearance: "interaction-only",
            callback: (token) => {
              void submitClaim(token, attempt);
            },
            "error-callback": () => {
              failAttempt("generic", attempt);
              return true;
            },
            "expired-callback": () => failAttempt("generic", attempt),
            "timeout-callback": () => {
              failAttempt("verification-timeout", attempt);
            },
            "unsupported-callback": () => {
              failAttempt("unsupported", attempt);
            },
          });
        } catch {
          failAttempt("script", attempt);
          return;
        }

        if (!isUsableWidgetId(renderedWidgetId)) {
          failAttempt("script", attempt);
          return;
        }
        if (activeAttemptRef.current !== attempt) {
          try {
            readyApi.remove(renderedWidgetId);
          } catch {
            // The attempt was superseded; no UI state depends on teardown.
          }
          return;
        }

        widgetIdRef.current = renderedWidgetId;
        challengeRunningRef.current = true;
        try {
          readyApi.execute(renderedWidgetId);
        } catch {
          challengeRunningRef.current = false;
          failAttempt("generic", attempt);
        }
      });
    } catch {
      preparingAttemptRef.current = null;
      failAttempt("script", attempt);
    }
  }, [
    failAttempt,
    safeRemoveWidget,
    submitClaim,
    verifiedSiteKey,
  ]);

  const beginAttempt = useCallback((choice: VisitorChoice) => {
    if (!mountedRef.current || !validSiteKey || snapshot.choice) return;

    clearVerificationTimeout();
    abortPost();
    retireWidget();

    const attempt = ++attemptSequenceRef.current;
    activeAttemptRef.current = attempt;
    pendingChoiceRef.current = choice;
    setPendingChoice(choice);
    setFailureReason("generic");
    setPhase("verifying");
    verificationTimerRef.current = window.setTimeout(() => {
      failAttempt("verification-timeout", attempt);
    }, VERIFICATION_TIMEOUT_MS);

    prepareAndExecute(attempt);
  }, [
    abortPost,
    clearVerificationTimeout,
    failAttempt,
    prepareAndExecute,
    retireWidget,
    snapshot.choice,
    validSiteKey,
  ]);

  const handleScriptReady = useCallback(() => {
    scriptReloadPendingRef.current = false;
    scriptStateRef.current = "ready";
    const api = currentTurnstileApi();
    const waitingAttempt = waitingForScriptAttemptRef.current;
    if (!api) {
      failAttempt("script", waitingAttempt ?? undefined);
      return;
    }
    if (waitingAttempt !== null
      && activeAttemptRef.current === waitingAttempt) {
      waitingForScriptAttemptRef.current = null;
      prepareAndExecute(waitingAttempt);
    }
  }, [failAttempt, prepareAndExecute]);

  const handleScriptError = useCallback(() => {
    scriptReloadPendingRef.current = false;
    scriptStateRef.current = "error";
    failAttempt("script", activeAttemptRef.current ?? undefined);
  }, [failAttempt]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const signal = await buildLimitedClientSignal();
        if (cancelled) return;
        clientSignalRef.current = signal;
        const payload = await fetchSnapshot();
        if (cancelled) return;
        claimCompletedRef.current = Boolean(payload.choice);
        setSnapshot(payload);
        pendingChoiceRef.current = null;
        setPendingChoice(null);
        if (payload.choice) {
          setPhase("claimed");
        } else if (!validSiteKey) {
          setFailureReason("service-unavailable");
          setPhase("unavailable");
        } else if (scriptStateRef.current === "error") {
          setFailureReason("script");
          setPhase("error");
        } else {
          setPhase("ready");
        }
      } catch {
        if (!cancelled) {
          setFailureReason("service-unavailable");
          setPhase("unavailable");
        }
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      clearVerificationTimeout();
      abortPost();
      abortSnapshot();
      activeAttemptRef.current = null;
      retryRunningRef.current = false;
      preparingAttemptRef.current = null;
      waitingForScriptAttemptRef.current = null;
      safeRemoveWidget();
    };
  }, [
    abortPost,
    abortSnapshot,
    clearVerificationTimeout,
    fetchSnapshot,
    safeRemoveWidget,
    validSiteKey,
  ]);

  const choose = useCallback((choice: VisitorChoice) => {
    if (phase !== "ready" || snapshot.choice || !validSiteKey) return;
    beginAttempt(choice);
  }, [beginAttempt, phase, snapshot.choice, validSiteKey]);

  const retry = useCallback(async () => {
    if ((phase !== "error" && phase !== "unavailable")
      || !mountedRef.current
      || retryRunningRef.current) {
      return;
    }

    retryRunningRef.current = true;
    const retryChoice = pendingChoiceRef.current;
    setPhase("recovering");
    clearVerificationTimeout();
    abortPost();
    abortSnapshot();
    activeAttemptRef.current = null;
    preparingAttemptRef.current = null;
    waitingForScriptAttemptRef.current = null;
    retireWidget();

    try {
      const payload = await fetchSnapshot();
      if (!mountedRef.current) return;
      claimCompletedRef.current = Boolean(payload.choice);
      setSnapshot(payload);
      if (payload.choice) {
        retryRunningRef.current = false;
        pendingChoiceRef.current = null;
        setPendingChoice(null);
        setFailureReason("generic");
        setPhase("claimed");
        return;
      }
      if (!validSiteKey) {
        retryRunningRef.current = false;
        setFailureReason("service-unavailable");
        setPhase("unavailable");
        return;
      }

      const mustReloadScript =
        scriptStateRef.current === "error" || !currentTurnstileApi();
      if (mustReloadScript) {
        scriptReloadPendingRef.current = true;
        scriptStateRef.current = "loading";
        try {
          window.turnstile = undefined;
        } catch {
          // A fresh Script element still provides the recovery boundary.
        }
        setScriptGeneration((value) => value + 1);
      }

      retryRunningRef.current = false;
      if (retryChoice) {
        beginAttempt(retryChoice);
      } else {
        setFailureReason("generic");
        setPhase("ready");
      }
    } catch {
      retryRunningRef.current = false;
      if (!mountedRef.current) return;
      setFailureReason("service-unavailable");
      setPhase("unavailable");
    }
  }, [
    abortPost,
    abortSnapshot,
    beginAttempt,
    clearVerificationTimeout,
    fetchSnapshot,
    phase,
    retireWidget,
    validSiteKey,
  ]);

  const claimedChoice = snapshot.choice;
  const failureMessage = failureReason === "script"
    ? copy.scriptError
    : failureReason === "unsupported"
      ? copy.unsupported
      : failureReason === "verification-timeout"
        ? copy.verificationTimeout
        : failureReason === "request-timeout"
          ? copy.requestTimeout
          : failureReason === "rejected"
            ? copy.rejected
            : failureReason === "rate-limited"
              ? copy.rateLimited
              : failureReason === "service-unavailable"
                ? copy.unavailable
                : copy.error;
  const statusMessage = phase === "loading"
    ? copy.loading
    : phase === "verifying"
      ? copy.verifying
      : phase === "recovering"
        ? copy.recovering
        : phase === "unavailable" || phase === "error"
          ? failureMessage
          : claimedChoice && snapshot.visitorNumber
            ? `${copy.result(claimedChoice, snapshot.visitorNumber)} ${copy.alreadyClaimed}`
            : "";
  const canChoose = phase === "ready"
    && !claimedChoice
    && validSiteKey;
  const retryable = phase === "error" || phase === "unavailable";
  const busy = phase === "loading"
    || phase === "verifying"
    || phase === "recovering";
  const turnstileScriptSrc = scriptGeneration === 0
    ? TURNSTILE_SCRIPT_URL
    : `${TURNSTILE_SCRIPT_URL}#axora-retry-${scriptGeneration}`;

  return (
    <section
      className={styles.section}
      aria-labelledby="visitor-choice-title"
      aria-busy={busy}
      data-hovered={hovered ?? "none"}
      data-claimed={claimedChoice ?? "none"}
      data-phase={phase}
    >
      {validSiteKey ? (
        <Script
          key={scriptGeneration}
          id={`axora-visitor-turnstile-${scriptGeneration}`}
          src={turnstileScriptSrc}
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
          disabled={!canChoose}
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
          {pendingChoice === "EARLY_BIRD" && busy ? (
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
          disabled={!canChoose}
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
          {pendingChoice === "NIGHT_OWL" && busy ? (
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
        role={retryable ? "alert" : "status"}
        aria-live="polite"
      >
        {statusMessage ? <p>{statusMessage}</p> : null}
        {retryable ? (
          <button
            type="button"
            onClick={() => void retry()}
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
