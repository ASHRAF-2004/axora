"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupportedLocale } from "@/lib/i18n";
import { contactVerificationFailure, contactVerificationMessages, type ContactVerificationFailure } from "@/lib/contact-verification-i18n";
import { ContactSubmitButton } from "./ContactSubmitButton";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string | undefined;
  remove: (widgetId: string) => void;
  reset: (widgetId: string) => void;
};

function turnstileApi() {
  return (window as Window & { turnstile?: TurnstileApi }).turnstile;
}

export function ContactVerificationControls({
  locale,
  siteKey,
  submit,
  sending,
  validationNote,
  unavailableMessage,
}: {
  locale: SupportedLocale;
  siteKey: string;
  submit: string;
  sending: string;
  validationNote: string;
  unavailableMessage: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | undefined>(undefined);
  const [verified, setVerified] = useState(false);
  const [failure, setFailure] = useState<ContactVerificationFailure | null>(null);
  const copy = contactVerificationMessages(locale);

  const renderWidget = useCallback(() => {
    const api = turnstileApi();
    if (!containerRef.current || widgetIdRef.current) return;
    if (!api) { setFailure({ kind: "script", code: null, retry: false }); return; }
    try {
      const widgetId = api.render(containerRef.current, {
        sitekey: siteKey,
        action: "contact",
        theme: "auto",
        language: locale,
        retry: "never",
        "refresh-expired": "manual",
        "refresh-timeout": "manual",
        callback: () => { setVerified(true); setFailure(null); },
        "expired-callback": () => { setVerified(false); setFailure({ kind: "expired", code: null, retry: true }); },
        "timeout-callback": () => { setVerified(false); setFailure({ kind: "timeout", code: null, retry: true }); },
        "unsupported-callback": () => { setVerified(false); setFailure({ kind: "unsupported", code: null, retry: false }); return true; },
        "error-callback": (code: unknown) => { setVerified(false); setFailure(contactVerificationFailure(code)); return true; },
      });
      if (widgetId) widgetIdRef.current = widgetId;
      else setFailure({ kind: "script", code: null, retry: false });
    } catch {
      setVerified(false);
      setFailure({ kind: "failed", code: null, retry: false });
    }
  }, [locale, siteKey]);

  const retryVerification = () => {
    const api = turnstileApi();
    if (!failure?.retry || !api || !widgetIdRef.current) return;
    setVerified(false);
    setFailure(null);
    try { api.reset(widgetIdRef.current); }
    catch { setFailure({ kind: "failed", code: null, retry: false }); }
  };

  useEffect(() => () => {
    const api = turnstileApi();
    if (api && widgetIdRef.current) api.remove(widgetIdRef.current);
  }, []);

  return <>
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={renderWidget} onError={() => { setVerified(false); setFailure({ kind: "script", code: null, retry: false }); }} />
    <div ref={containerRef} data-contact-verification />
    {failure ? <div className="form-alert" role="status" aria-live="polite">
      <p>{failure.kind === "configuration" ? unavailableMessage : copy[failure.kind]}</p>
      {failure.code ? <p>{copy.reference}: <bdi>{failure.code}</bdi></p> : null}
      <div className="information-actions">
        {failure.retry ? <button type="button" className="button button-secondary" onClick={retryVerification}>{copy.retry}</button> : null}
        <a href="https://developers.cloudflare.com/cloudflare-challenges/troubleshooting/challenge-solve-issues/" target="_blank" rel="noopener noreferrer">{copy.help}</a>
      </div>
    </div> : null}
    <div className="public-contact-submit"><span>{validationNote}</span><ContactSubmitButton submit={submit} sending={sending} unavailable={!verified} /></div>
  </>;
}
