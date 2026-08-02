"use client";

import {
  completePasswordResetAction,
  inspectPasswordResetTokenAction,
  type PasswordResetCompletionState,
  type PasswordResetInspectionState,
} from "@/app/account/reset-password/actions";
import { SecuritySubmitButton } from "@/components/SecuritySubmitButton";
import { PasswordField } from "@/components/PasswordField";
import { readAndClearSecurityTokenFragment } from "@/lib/security-token-fragment";
import { accountLifecycleMessages } from "@/lib/account-lifecycle-i18n";
import { LOCALE_NAMES, persistBrowserLocale, type SupportedLocale } from "@/lib/i18n";
import { KeyRound, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState, useLayoutEffect, useMemo, useRef, useState } from "react";

const INITIAL_STATE: PasswordResetCompletionState = { status: "idle" };
type ResetView =
  | { status: "loading" }
  | { status: "invalid" | "unavailable" }
  | { status: "valid"; rawToken: string };

function ResetMessage({ locale, unavailable = false }: { locale: SupportedLocale; unavailable?: boolean }) {
  const copy = accountLifecycleMessages(locale);
  return (
    <article className="login-card" aria-labelledby="reset-message-title" lang={locale} dir={LOCALE_NAMES[locale].dir}>
      <div className="login-icon"><KeyRound size={24} /></div>
      <p className="eyebrow">{copy.reset.eyebrow}</p>
      <h2 id="reset-message-title">{unavailable ? copy.reset.unavailableTitle : copy.reset.invalidTitle}</h2>
      <div className="form-alert" role="alert">
        {unavailable
          ? copy.reset.unavailableBody
          : copy.reset.invalidBody}
      </div>
      <p className="muted">{copy.reset.invalidHelp}</p>
      <div className="public-info-actions">
        <Link className="button button-secondary" href="/account/forgot-password">{copy.common.requestNewLink}</Link>
        <Link className="button button-primary" href="/login">{copy.common.signIn}</Link>
      </div>
    </article>
  );
}

function PasswordResetForm({ rawToken, locale }: { rawToken: string; locale: SupportedLocale }) {
  const copy = accountLifecycleMessages(locale).reset;
  const action = useMemo(() => completePasswordResetAction.bind(null, rawToken), [rawToken]);
  const [completion, formAction] = useActionState(action, INITIAL_STATE);
  return (
    <form className="login-card" action={formAction} aria-labelledby="reset-password-title" data-ux-silent="true" lang={locale} dir={LOCALE_NAMES[locale].dir}>
      <div className="login-icon"><KeyRound size={24} /></div>
      <p className="eyebrow">{copy.formEyebrow}</p>
      <h2 id="reset-password-title">{copy.formTitle}</h2>
      <p className="muted">{copy.formBody}</p>
      {completion.code ? <div className="form-alert" role="alert" aria-live="polite">{copy.errors[completion.code]}</div> : null}
      <PasswordField
        id="reset-password"
        name="password"
        label={copy.newPassword}
        showLabel={copy.showPassword}
        hideLabel={copy.hidePassword}
        autoComplete="new-password"
        describedBy="reset-password-help"
        disabled={completion.status === "invalid"}
        enforceNewPasswordPolicy
        tooShortMessage={copy.passwordTooShort}
        tooLongMessage={copy.passwordTooLong}
      />
      <PasswordField
        id="reset-password-confirmation"
        name="confirmPassword"
        label={copy.confirmPassword}
        showLabel={copy.showPassword}
        hideLabel={copy.hidePassword}
        autoComplete="new-password"
        describedBy="reset-password-help"
        disabled={completion.status === "invalid"}
        enforceNewPasswordPolicy
        tooShortMessage={copy.passwordTooShort}
        tooLongMessage={copy.passwordTooLong}
      />
      <p id="reset-password-help" className="account-setup-requirements">{copy.requirements}</p>
      <SecuritySubmitButton label={copy.submit} pendingLabel={copy.submitting} disabled={completion.status === "invalid"} />
      <p className="demo-note">{copy.oneTimeNote}</p>
    </form>
  );
}

export function PasswordResetClient({ initialLocale }: { initialLocale: SupportedLocale }) {
  const [view, setView] = useState<ResetView>({ status: "loading" });
  const [locale, setLocale] = useState(initialLocale);
  const tokenRef = useRef<string | undefined>(undefined);
  const inspectionRef = useRef<Promise<PasswordResetInspectionState> | undefined>(undefined);
  useLayoutEffect(() => {
    let active = true;
    if (tokenRef.current === undefined) {
      tokenRef.current = readAndClearSecurityTokenFragment(window.location, window.history);
    }
    const rawToken = tokenRef.current;
    inspectionRef.current ??= rawToken
      ? inspectPasswordResetTokenAction(rawToken)
      : Promise.resolve({ status: "invalid" });
    void inspectionRef.current.then((inspection) => {
      if (!active) return;
      if (inspection.status === "valid") {
        setLocale(inspection.locale);
        persistBrowserLocale(inspection.locale);
        setView(rawToken
          ? { status: "valid", rawToken }
          : { status: "invalid" });
        return;
      }
      tokenRef.current = "";
      setView({ status: inspection.status });
    }).catch(() => {
      if (!active) return;
      tokenRef.current = "";
      setView({ status: "unavailable" });
    });
    return () => { active = false; };
  }, []);

  if (view.status === "loading") {
    const copy = accountLifecycleMessages(locale).reset;
    return (
      <article className="login-card" role="status" aria-live="polite" lang={locale} dir={LOCALE_NAMES[locale].dir}>
        <div className="login-icon"><LoaderCircle className="ux-spin" size={24} /></div>
        <p className="eyebrow">{copy.eyebrow}</p>
        <h2>{copy.checkingTitle}</h2>
        <p className="muted">{copy.checkingBody}</p>
      </article>
    );
  }
  if (view.status !== "valid") return <ResetMessage locale={locale} unavailable={view.status === "unavailable"} />;
  return <PasswordResetForm rawToken={view.rawToken} locale={locale} />;
}
