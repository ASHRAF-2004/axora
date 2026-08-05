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

type TurnstileWidgetId = string;

type TurnstileOptions = {
  sitekey: string;
  action: "visitor_choice";
  theme: "auto";
  size: "flexible";
  execution: "execute";
  appearance: "interaction-only";
  callback: (token: string) => void;
  "error-callback": () => void;
  "expired-callback": () => void;
  "timeout-callback": () => void;
};

type TurnstileApi = {
  ready: (callback: () => void) => void;
  render: (
    container: HTMLElement,
    options: TurnstileOptions,
  ) => TurnstileWidgetId;
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
  const [snapshot, setSnapshot] = useState<VisitorCounterSnapshot>({
    totalCount: 0,
    earlyBirdCount: 0,
    nightOwlCount: 0,
  });
  const [phase, setPhase] = useState<Phase>("loading");
  const [hovered, setHovered] = useState<VisitorChoice | null>(null);
  const [pendingChoice, setPendingChoice] = useState<VisitorChoice | null>(
    null,
  );
  const widgetContainerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<TurnstileWidgetId | null>(null);
  const pendingChoiceRef = useRef<VisitorChoice | null>(null);
  const clientSignalRef = useRef<string | undefined>(undefined);
  const challengeRunningRef = useRef(false);
  const mountedRef = useRef(true);

  const percentages = useMemo(
    () => visitorChoicePercentages(snapshot),
    [snapshot],
  );
  const numberFormatter = useMemo(
    () => new Intl.NumberFormat(localeTag),
    [localeTag],
  );

  const resetChallenge = useCallback(() => {
    challengeRunningRef.current = false;
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  const failChallenge = useCallback(() => {
    if (!mountedRef.current) return;
    resetChallenge();
    pendingChoiceRef.current = null;
    setPendingChoice(null);
    setPhase("error");
  }, [resetChallenge]);

  const submitClaim = useCallback(async (turnstileToken: string) => {
    const choice = pendingChoiceRef.current;
    if (!choice || !turnstileToken) {
      failChallenge();
      return;
    }
    try {
      const response = await fetch("/api/public/visitor-choice", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        credentials: "same-origin",
        cache: "no-store",
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
      if (!response.ok || !isSnapshot(payload)
        || !payload.choice || !payload.visitorNumber) {
        throw new Error("claim_failed");
      }
      if (!mountedRef.current) return;
      challengeRunningRef.current = false;
      pendingChoiceRef.current = null;
      setPendingChoice(null);
      setSnapshot(payload);
      setPhase("claimed");
    } catch {
      failChallenge();
    }
  }, [failChallenge, locale]);

  const executePendingChallenge = useCallback(() => {
    if (!pendingChoiceRef.current
      || challengeRunningRef.current
      || !widgetIdRef.current
      || !window.turnstile) {
      return;
    }
    challengeRunningRef.current = true;
    window.turnstile.execute(widgetIdRef.current);
  }, []);

  const initializeTurnstile = useCallback(() => {
    if (!validSiteKey || !siteKey
      || widgetIdRef.current
      || !widgetContainerRef.current
      || !window.turnstile) {
      return;
    }
    window.turnstile.ready(() => {
      if (!mountedRef.current
        || widgetIdRef.current
        || !widgetContainerRef.current
        || !window.turnstile) {
        return;
      }
      widgetIdRef.current = window.turnstile.render(
        widgetContainerRef.current,
        {
          sitekey: siteKey,
          action: "visitor_choice",
          theme: "auto",
          size: "flexible",
          execution: "execute",
          appearance: "interaction-only",
          callback: (token) => {
            void submitClaim(token);
          },
          "error-callback": failChallenge,
          "expired-callback": failChallenge,
          "timeout-callback": failChallenge,
        },
      );
      executePendingChallenge();
    });
  }, [
    executePendingChallenge,
    failChallenge,
    siteKey,
    submitClaim,
    validSiteKey,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    void (async () => {
      try {
        const signal = await buildLimitedClientSignal();
        if (cancelled) return;
        clientSignalRef.current = signal;
        const response = await fetch(
          "/api/public/visitor-choice",
          {
            headers: signal
              ? { "X-Axora-Visitor-Signal": signal }
              : undefined,
            credentials: "same-origin",
            cache: "no-store",
          },
        );
        const payload: unknown = await response.json();
        if (!response.ok || !isSnapshot(payload)) {
          throw new Error("snapshot_failed");
        }
        if (cancelled) return;
        setSnapshot(payload);
        setPhase(payload.choice ? "claimed" : validSiteKey
          ? "ready"
          : "unavailable");
      } catch {
        if (!cancelled) setPhase("unavailable");
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
      widgetIdRef.current = null;
    };
  }, [validSiteKey]);

  const choose = useCallback((choice: VisitorChoice) => {
    if (snapshot.choice
      || phase === "loading"
      || phase === "verifying"
      || !validSiteKey) {
      return;
    }
    pendingChoiceRef.current = choice;
    setPendingChoice(choice);
    setPhase("verifying");
    initializeTurnstile();
    executePendingChallenge();
  }, [
    executePendingChallenge,
    initializeTurnstile,
    phase,
    snapshot.choice,
    validSiteKey,
  ]);

  const claimedChoice = snapshot.choice;
  const statusMessage = phase === "loading"
    ? copy.loading
    : phase === "verifying"
      ? copy.verifying
      : phase === "unavailable"
        ? copy.unavailable
        : phase === "error"
          ? copy.error
          : claimedChoice && snapshot.visitorNumber
            ? `${copy.result(claimedChoice, snapshot.visitorNumber)} ${copy.alreadyClaimed}`
            : "";

  return (
    <section
      className={styles.section}
      aria-labelledby="visitor-choice-title"
      data-hovered={hovered ?? "none"}
      data-claimed={claimedChoice ?? "none"}
    >
      {validSiteKey ? (
        <Script
          id="axora-visitor-turnstile"
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
          onLoad={initializeTurnstile}
          onReady={initializeTurnstile}
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
            || phase === "loading"
            || phase === "verifying"
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
            || phase === "loading"
            || phase === "verifying"
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
            onClick={() => setPhase("ready")}
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
