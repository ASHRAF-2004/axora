"use client";

import { publicVisitorCopy } from "@/lib/public-visitor-copy";
import type { VisitorChoice, VisitorCounterSnapshot } from "@/lib/public-visitor-counter";
import type { SupportedLocale } from "@/lib/i18n";
import { MoonStar, ShieldCheck, Sparkles, Sunrise } from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./VisitorChoiceChallenge.module.css";

type Phase = "loading" | "ready" | "verifying" | "claimed" | "unavailable" | "error" | "ineligible";
type TurnstileWidgetId = string;
type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => TurnstileWidgetId | undefined;
  execute: (widgetId: TurnstileWidgetId) => void;
  reset: (widgetId: TurnstileWidgetId) => void;
  remove: (widgetId: TurnstileWidgetId) => void;
};
type SnapshotLoadResult =
  | { status: "success" }
  | { status: "ineligible" }
  | { status: "aborted" }
  | { status: "error"; retryAfterMs?: number };

declare global { interface Window { turnstile?: TurnstileApi } }

const GET_TIMEOUT_MS = 10_000;
const VERIFY_TIMEOUT_MS = 18_000;
const POST_TIMEOUT_MS = 12_000;
const POLL_INTERVAL_MS = 30_000;
const MAX_POLL_BACKOFF_MS = 120_000;
const emptySnapshot: VisitorCounterSnapshot = {
  version: 0,
  totalCount: 0,
  earlyBirdCount: 0,
  nightOwlCount: 0,
};

class SnapshotRequestError extends Error {
  constructor(readonly retryAfterMs?: number) {
    super("snapshot");
  }
}

function parseSnapshot(value: unknown): VisitorCounterSnapshot | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Partial<VisitorCounterSnapshot>;
  const version = item.version ?? item.totalCount;
  if (![version, item.totalCount, item.earlyBirdCount, item.nightOwlCount]
    .every((count) => Number.isSafeInteger(count) && Number(count) >= 0)
    || item.totalCount !== Number(item.earlyBirdCount) + Number(item.nightOwlCount)
    || Number(version) < Number(item.totalCount)
    || (item.choice !== undefined && item.choice !== "EARLY_BIRD" && item.choice !== "NIGHT_OWL")
    || ((item.choice === undefined) !== (item.visitorNumber === undefined))) {
    return undefined;
  }
  return { ...item, version: Number(version) } as VisitorCounterSnapshot;
}

function retryAfterMilliseconds(response: Response) {
  const value = response.headers.get("retry-after")?.trim();
  if (!value) return undefined;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds)
    ? seconds * 1_000
    : Date.parse(value) - Date.now();
  if (!Number.isFinite(milliseconds)) return undefined;
  return Math.min(MAX_POLL_BACKOFF_MS, Math.max(5_000, milliseconds));
}

async function requestSnapshot(signal?: AbortSignal) {
  const response = await fetch("/api/public/visitor-choice", {
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (response.status === 403
    || (payload && typeof payload === "object" && (payload as { eligible?: unknown }).eligible === false)) {
    return { eligible: false as const };
  }
  const snapshot = parseSnapshot(payload);
  if (!response.ok || !snapshot) {
    throw new SnapshotRequestError(retryAfterMilliseconds(response));
  }
  return { eligible: true as const, snapshot };
}

export function visitorChoicePercentages(snapshot: VisitorCounterSnapshot) {
  if (!snapshot.totalCount) return { early: 50, night: 50 };
  const early = Math.round((snapshot.earlyBirdCount / snapshot.totalCount) * 100);
  return { early, night: 100 - early };
}

export function VisitorChoiceChallenge({
  locale,
  siteKey,
  initialSnapshot,
}: {
  locale: SupportedLocale;
  siteKey?: string;
  initialSnapshot?: VisitorCounterSnapshot;
}) {
  const copy = publicVisitorCopy[locale];
  const validSiteKey = Boolean(siteKey && /^[A-Za-z0-9_-]{10,100}$/.test(siteKey));
  const [snapshot, setSnapshot] = useState<VisitorCounterSnapshot>(initialSnapshot ?? emptySnapshot);
  const [phase, setPhase] = useState<Phase>(
    initialSnapshot?.choice
      ? "claimed"
      : initialSnapshot
        ? validSiteKey ? "ready" : "unavailable"
        : "loading",
  );
  const [pendingChoice, setPendingChoice] = useState<VisitorChoice | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [pollGeneration, setPollGeneration] = useState(0);
  const modalRef = useRef<HTMLElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<TurnstileWidgetId | null>(null);
  const choiceRef = useRef<VisitorChoice | null>(null);
  const attempt = useRef(0);
  const attempting = useRef(false);
  const busy = useRef(false);
  const verificationTimer = useRef<number | null>(null);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale === "ms" ? "ms-MY" : locale), [locale]);
  const percentages = useMemo(() => visitorChoicePercentages(snapshot), [snapshot]);
  const claimed = Boolean(snapshot.choice);

  useEffect(() => {
    const modal = modalRef.current;
    if (!modal) return;
    modal.dataset.interactive = "true";
    return () => {
      delete modal.dataset.interactive;
    };
  }, []);

  const applySnapshot = useCallback((next: VisitorCounterSnapshot) => {
    setSnapshot((current) => {
      if (next.version < current.version) return current;
      if (next.choice) return next;
      return current.choice
        ? { ...next, choice: current.choice, visitorNumber: current.visitorNumber }
        : next;
    });
  }, []);

  const load = useCallback(async (resetInteraction = false, signal?: AbortSignal): Promise<SnapshotLoadResult> => {
    try {
      const result = await requestSnapshot(signal);
      if (!result.eligible) {
        setPhase("ineligible");
        return { status: "ineligible" };
      }
      applySnapshot(result.snapshot);
      setPhase((current) => {
        if (result.snapshot.choice) return "claimed";
        if (resetInteraction || current === "loading" || current === "unavailable") {
          return validSiteKey ? "ready" : "unavailable";
        }
        return current;
      });
      return { status: "success" };
    } catch (error) {
      if (signal?.aborted) return { status: "aborted" };
      if (resetInteraction) {
        setErrorMessage(copy.unavailable);
        setPhase("error");
      }
      return {
        status: "error",
        ...(error instanceof SnapshotRequestError && error.retryAfterMs
          ? { retryAfterMs: error.retryAfterMs }
          : {}),
      };
    }
  }, [applySnapshot, copy.unavailable, validSiteKey]);

  useEffect(() => {
    let timer: number | undefined;
    let controller: AbortController | undefined;
    let stopped = false;
    let requestNumber = 0;
    let failures = 0;

    const cancel = () => {
      requestNumber += 1;
      controller?.abort();
      controller = undefined;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };
    const schedule = (delay: number) => {
      if (stopped || document.hidden || navigator.onLine === false) return;
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => void run(false), delay);
    };
    const run = async (resetInteraction: boolean) => {
      if (stopped || document.hidden || navigator.onLine === false) return;
      cancel();
      const currentRequest = requestNumber;
      controller = new AbortController();
      let timedOut = false;
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller?.abort();
      }, GET_TIMEOUT_MS);
      const result = await load(resetInteraction, controller.signal);
      window.clearTimeout(timeout);
      if (stopped || currentRequest !== requestNumber) return;
      controller = undefined;
      if (result.status === "ineligible") return;
      if (result.status === "success") {
        failures = 0;
        schedule(POLL_INTERVAL_MS);
        return;
      }
      if (result.status === "aborted" && timedOut) {
        failures += 1;
        schedule(Math.min(
          MAX_POLL_BACKOFF_MS,
          POLL_INTERVAL_MS * (2 ** Math.min(failures - 1, 2)),
        ));
        return;
      }
      if (result.status === "error") {
        failures += 1;
        schedule(result.retryAfterMs ?? Math.min(
          MAX_POLL_BACKOFF_MS,
          POLL_INTERVAL_MS * (2 ** Math.min(failures - 1, 2)),
        ));
      }
    };
    const visibility = () => {
      if (document.hidden) cancel();
      else void run(false);
    };
    const online = () => void run(false);
    const offline = () => cancel();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    void run(pollGeneration > 0 || !initialSnapshot);
    return () => {
      stopped = true;
      cancel();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [initialSnapshot, load, pollGeneration]);

  useEffect(() => {
    if (claimed || phase === "loading" || phase === "unavailable" || phase === "ineligible") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const target = modalRef.current;
    target?.focus();
    const firstButton = target?.querySelector<HTMLButtonElement>("button:not(:disabled)");
    firstButton?.focus();
    const containFocus = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        return;
      }
      if (event.key !== "Tab" || !target) return;
      const controls = [...target.querySelectorAll<HTMLElement>("button:not(:disabled),a[href],[tabindex]:not([tabindex='-1'])")];
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", containFocus);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", containFocus);
    };
  }, [claimed, phase]);

  useEffect(() => {
    if (claimed || phase !== "ready") return;
    modalRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [claimed, phase]);

  useEffect(() => () => {
    if (verificationTimer.current !== null) window.clearTimeout(verificationTimer.current);
  }, []);

  const finish = useCallback(async (token: string, attemptId: number) => {
    const choice = choiceRef.current;
    if (!choice || busy.current || !token) return;
    busy.current = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), POST_TIMEOUT_MS);
    try {
      const response = await fetch("/api/public/visitor-choice", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ choice, locale, turnstileToken: token }),
        signal: controller.signal,
      });
      const payload: unknown = await response.json().catch(() => null);
      if (attemptId !== attempt.current) return;
      if (!response.ok) {
        if (response.status === 429) throw new Error("rate");
        if (response.status >= 500) throw new Error("unavailable");
        throw new Error("verify");
      }
      const claimedSnapshot = parseSnapshot(payload);
      if (!claimedSnapshot?.choice || !claimedSnapshot.visitorNumber) throw new Error("verify");
      setSnapshot(claimedSnapshot);
      setPendingChoice(null);
      choiceRef.current = null;
      setPhase("claimed");
    } catch (error) {
      if (attemptId !== attempt.current) return;
      setErrorMessage(
        error instanceof Error && error.message === "rate"
          ? copy.rateLimited
          : error instanceof Error && error.message === "unavailable"
            ? copy.unavailable
            : controller.signal.aborted
              ? copy.requestTimeout
              : copy.rejected,
      );
      setPhase("error");
    } finally {
      busy.current = false;
      if (attemptId === attempt.current) {
        attempting.current = false;
        if (verificationTimer.current !== null) {
          window.clearTimeout(verificationTimer.current);
          verificationTimer.current = null;
        }
      }
      window.clearTimeout(timer);
    }
  }, [copy.rateLimited, copy.rejected, copy.requestTimeout, copy.unavailable, locale]);

  const ensureWidget = useCallback((attemptId: number) => {
    const fail = (message: string) => {
      if (attemptId !== attempt.current) return;
      attempting.current = false;
      if (verificationTimer.current !== null) {
        window.clearTimeout(verificationTimer.current);
        verificationTimer.current = null;
      }
      setErrorMessage(message);
      setPhase("error");
    };
    if (!window.turnstile || !widgetRef.current || !siteKey) {
      fail(copy.scriptError);
      return;
    }
    try {
      if (widgetId.current) {
        window.turnstile.reset(widgetId.current);
        window.turnstile.execute(widgetId.current);
        return;
      }
      const id = window.turnstile.render(widgetRef.current, {
        sitekey: siteKey,
        action: "visitor_choice",
        theme: "auto",
        size: "flexible",
        execution: "execute",
        appearance: "interaction-only",
        retry: "never",
        callback: (token: unknown) => { if (typeof token === "string") void finish(token, attemptId); },
        "error-callback": () => { fail(copy.error); return true; },
        "expired-callback": () => fail(copy.timeout),
        "timeout-callback": () => fail(copy.timeout),
        "unsupported-callback": () => { fail(copy.unsupported); return true; },
      });
      if (!id) { fail(copy.scriptError); return; }
      widgetId.current = id;
      window.turnstile.execute(id);
    } catch {
      fail(copy.error);
    }
  }, [copy.error, copy.scriptError, copy.timeout, copy.unsupported, finish, siteKey]);

  const choose = useCallback((choice: VisitorChoice) => {
    if (phase !== "ready" || attempting.current || busy.current || claimed) return;
    attempting.current = true;
    const currentAttempt = ++attempt.current;
    choiceRef.current = choice;
    setPendingChoice(choice);
    setErrorMessage("");
    setPhase("verifying");
    if (verificationTimer.current !== null) window.clearTimeout(verificationTimer.current);
    verificationTimer.current = window.setTimeout(() => {
      if (currentAttempt !== attempt.current || busy.current) return;
      attempting.current = false;
      setErrorMessage(copy.timeout);
      setPhase("error");
    }, VERIFY_TIMEOUT_MS);
    ensureWidget(currentAttempt);
  }, [claimed, copy.timeout, ensureWidget, phase]);

  const retry = useCallback(() => {
    attempt.current += 1;
    attempting.current = false;
    busy.current = false;
    if (verificationTimer.current !== null) {
      window.clearTimeout(verificationTimer.current);
      verificationTimer.current = null;
    }
    choiceRef.current = null;
    setPendingChoice(null);
    setErrorMessage("");
    if (widgetId.current && window.turnstile) {
      window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    }
    setPhase("loading");
    setPollGeneration((current) => current + 1);
  }, []);

  if (phase === "ineligible") return null;

  if (claimed) {
    return (
      <aside className={styles.compact} aria-label={copy.totalLabel} data-visitor-claimed="true">
        <span><Sunrise aria-hidden="true" />{copy.earlyCountLabel}<strong>{numberFormatter.format(snapshot.earlyBirdCount)}</strong></span>
        <span><MoonStar aria-hidden="true" />{copy.nightCountLabel}<strong>{numberFormatter.format(snapshot.nightOwlCount)}</strong></span>
        <span className={styles.compactTotal}>{copy.totalLabel}<strong>{numberFormatter.format(snapshot.totalCount)}</strong></span>
      </aside>
    );
  }

  return (
    <div className={styles.backdrop} data-phase={phase}>
      {validSiteKey ? <Script id="axora-visitor-turnstile" src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" /> : null}
      <section ref={modalRef} className={styles.section} role="dialog" aria-modal="true" aria-labelledby="visitor-choice-title" aria-describedby="visitor-choice-instructions" tabIndex={-1} data-phase={phase}>
        <div className={styles.glow} aria-hidden="true" />
        <header className={styles.header}>
          <p className={styles.eyebrow}><Sparkles size={16} aria-hidden="true" />{copy.eyebrow}</p>
          <h2 id="visitor-choice-title">{copy.title}</h2>
          <p id="visitor-choice-instructions">{copy.body}</p>
          <div className={styles.total} aria-live="polite"><strong>{numberFormatter.format(snapshot.totalCount)}</strong><span>{copy.totalLabel}</span></div>
        </header>
        <div className={styles.arena} role="group" aria-label={copy.groupLabel}>
          <button type="button" className={`${styles.side} ${styles.earlySide}`} aria-label={copy.chooseEarly} disabled={phase !== "ready"} onClick={() => choose("EARLY_BIRD")}>
            <span className={styles.iconDisc} aria-hidden="true"><Sunrise size={34} /></span>
            <span className={styles.sideCopy}><strong>{copy.earlyTitle}</strong><small>{copy.earlyDescription}</small></span>
            <span className={styles.sideCount}>{numberFormatter.format(snapshot.earlyBirdCount)} · {percentages.early}%</span>
            {pendingChoice === "EARLY_BIRD" ? <span className={styles.pendingPulse} aria-hidden="true" /> : null}
          </button>
          <span className={styles.versus} aria-hidden="true">VS</span>
          <button type="button" className={`${styles.side} ${styles.nightSide}`} aria-label={copy.chooseNight} disabled={phase !== "ready"} onClick={() => choose("NIGHT_OWL")}>
            <span className={styles.iconDisc} aria-hidden="true"><MoonStar size={34} /></span>
            <span className={styles.sideCopy}><strong>{copy.nightTitle}</strong><small>{copy.nightDescription}</small></span>
            <span className={styles.sideCount}>{numberFormatter.format(snapshot.nightOwlCount)} · {percentages.night}%</span>
            {pendingChoice === "NIGHT_OWL" ? <span className={styles.pendingPulse} aria-hidden="true" /> : null}
          </button>
        </div>
        <div className={styles.status} role={phase === "error" || phase === "unavailable" ? "alert" : "status"} aria-live="polite">
          {phase === "loading" ? <p>{copy.loading}</p> : null}
          {phase === "verifying" ? <p>{copy.verifying}</p> : null}
          {phase === "unavailable" ? <p>{copy.unavailable}</p> : null}
          {phase === "error" ? <><p>{errorMessage || copy.error}</p><button type="button" onClick={retry}>{copy.retry}</button></> : null}
        </div>
        <div ref={widgetRef} className={styles.turnstile} />
        <p className={styles.privacyNote}><ShieldCheck size={17} aria-hidden="true" /><span><strong>{copy.protectedBy}.</strong> {copy.privacy} <Link href={`/${locale}/privacy`}>{copy.privacyLink}</Link></span></p>
      </section>
    </div>
  );
}
