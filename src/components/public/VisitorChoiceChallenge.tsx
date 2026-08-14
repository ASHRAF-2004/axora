"use client";

import { publicVisitorCopy } from "@/lib/public-visitor-copy";
import type { VisitorChoice, VisitorCounterSnapshot } from "@/lib/public-visitor-counter";
import type { SupportedLocale } from "@/lib/i18n";
import { MoonStar, ShieldCheck, Sparkles, Sunrise } from "lucide-react";
import Link from "next/link";
import Script from "next/script";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./VisitorChoiceChallenge.module.css";

type Phase = "loading" | "ready" | "verifying" | "claimed" | "unavailable" | "error";
type TurnstileWidgetId = string;
type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => TurnstileWidgetId | undefined;
  execute: (widgetId: TurnstileWidgetId) => void;
  reset: (widgetId: TurnstileWidgetId) => void;
  remove: (widgetId: TurnstileWidgetId) => void;
};

declare global { interface Window { turnstile?: TurnstileApi } }

const GET_TIMEOUT_MS = 10_000;
const VERIFY_TIMEOUT_MS = 18_000;
const POST_TIMEOUT_MS = 12_000;
const emptySnapshot: VisitorCounterSnapshot = { totalCount: 0, earlyBirdCount: 0, nightOwlCount: 0 };

function isSnapshot(value: unknown): value is VisitorCounterSnapshot {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<VisitorCounterSnapshot>;
  return [item.totalCount, item.earlyBirdCount, item.nightOwlCount].every((count) => Number.isSafeInteger(count) && Number(count) >= 0)
    && item.totalCount === Number(item.earlyBirdCount) + Number(item.nightOwlCount)
    && (item.choice === undefined || item.choice === "EARLY_BIRD" || item.choice === "NIGHT_OWL")
    && ((item.choice === undefined) === (item.visitorNumber === undefined));
}

async function requestSnapshot(signal?: AbortSignal) {
  const response = await fetch("/api/public/visitor-choice", { credentials: "same-origin", cache: "no-store", signal });
  const payload: unknown = await response.json();
  if (!response.ok || !isSnapshot(payload)) throw new Error("snapshot");
  return payload;
}

export function visitorChoicePercentages(snapshot: VisitorCounterSnapshot) {
  if (!snapshot.totalCount) return { early: 50, night: 50 };
  const early = Math.round((snapshot.earlyBirdCount / snapshot.totalCount) * 100);
  return { early, night: 100 - early };
}

export function VisitorChoiceChallenge({ locale, siteKey }: { locale: SupportedLocale; siteKey?: string }) {
  const copy = publicVisitorCopy[locale];
  const validSiteKey = Boolean(siteKey && /^[A-Za-z0-9_-]{10,100}$/.test(siteKey));
  const [snapshot, setSnapshot] = useState<VisitorCounterSnapshot>(emptySnapshot);
  const [phase, setPhase] = useState<Phase>("loading");
  const [pendingChoice, setPendingChoice] = useState<VisitorChoice | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const modalRef = useRef<HTMLElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<TurnstileWidgetId | null>(null);
  const choiceRef = useRef<VisitorChoice | null>(null);
  const attempt = useRef(0);
  const attempting = useRef(false);
  const busy = useRef(false);
  const verificationTimer = useRef<number | null>(null);
  const sequence = useRef(0);
  const numberFormatter = useMemo(() => new Intl.NumberFormat(locale === "ms" ? "ms-MY" : locale), [locale]);
  const percentages = useMemo(() => visitorChoicePercentages(snapshot), [snapshot]);
  const claimed = Boolean(snapshot.choice);

  const load = useCallback(async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), GET_TIMEOUT_MS);
    try {
      const next = await requestSnapshot(controller.signal);
      setSnapshot(next);
      setPhase(next.choice ? "claimed" : validSiteKey ? "ready" : "unavailable");
    } catch {
      setErrorMessage(copy.unavailable);
      setPhase("error");
    } finally {
      window.clearTimeout(timer);
    }
  }, [copy.unavailable, validSiteKey]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  useEffect(() => {
    let source: EventSource | null = null;
    let fallback: number | undefined;
    const connect = () => {
      if (document.hidden || source) return;
      if (typeof globalThis.EventSource !== "function") {
        if (!fallback) fallback = window.setInterval(() => void load(), 15_000);
        return;
      }
      source = new EventSource("/api/public/visitor-choice/stream", { withCredentials: true });
      source.addEventListener("snapshot", (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent<string>).data) as VisitorCounterSnapshot & { sequence?: number };
          if (!isSnapshot(payload) || !Number.isSafeInteger(payload.sequence) || Number(payload.sequence) < sequence.current) return;
          sequence.current = Number(payload.sequence);
          setSnapshot((current) => ({ ...payload, ...(current.choice ? { choice: current.choice, visitorNumber: current.visitorNumber } : {}) }));
        } catch {
          // EventSource reconnects and the next event is an authoritative snapshot.
        }
      });
    };
    const visibility = () => {
      if (document.hidden) {
        source?.close(); source = null;
        if (fallback) window.clearInterval(fallback);
        fallback = undefined;
      } else connect();
    };
    const online = () => connect();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    connect();
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
      source?.close();
      if (fallback) window.clearInterval(fallback);
    };
  }, [load]);

  useEffect(() => {
    if (claimed) return;
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
  }, [claimed]);

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
      if (!isSnapshot(payload) || !payload.choice || !payload.visitorNumber) throw new Error("verify");
      setSnapshot(payload);
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
    void load();
  }, [load]);

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
