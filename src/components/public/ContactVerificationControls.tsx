"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";
import type { SupportedLocale } from "@/lib/i18n";
import { ContactSubmitButton } from "./ContactSubmitButton";

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string | undefined;
  remove: (widgetId: string) => void;
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
  const [failed, setFailed] = useState(false);

  const renderWidget = useCallback(() => {
    const api = turnstileApi();
    if (!api || !containerRef.current || widgetIdRef.current) return;
    const widgetId = api.render(containerRef.current, {
      sitekey: siteKey,
      action: "contact",
      theme: "auto",
      language: locale,
      callback: () => { setVerified(true); setFailed(false); },
      "expired-callback": () => setVerified(false),
      "timeout-callback": () => setVerified(false),
      "error-callback": () => { setVerified(false); setFailed(true); },
    });
    if (widgetId) widgetIdRef.current = widgetId;
  }, [locale, siteKey]);

  useEffect(() => () => {
    const api = turnstileApi();
    if (api && widgetIdRef.current) api.remove(widgetIdRef.current);
  }, []);

  return <>
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={renderWidget} />
    <div ref={containerRef} className="cf-turnstile" />
    {failed ? <p className="form-alert" role="status">{unavailableMessage}</p> : null}
    <div className="public-contact-submit"><span>{validationNote}</span><ContactSubmitButton submit={submit} sending={sending} unavailable={!verified} /></div>
  </>;
}
