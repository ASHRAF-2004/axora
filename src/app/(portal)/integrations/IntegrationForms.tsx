"use client";

import type { SupportedLocale } from "@/lib/i18n";
import { integrationManagementMessages } from "@/lib/integrations/management-i18n";
import { INTEGRATION_SCOPES } from "@/lib/integrations/scopes";
import { KeyRound, Power, RotateCcw, Unplug } from "lucide-react";
import { useActionState, useState } from "react";
import {
  createIntegrationApplicationAction,
  disconnectIntegrationAction,
  rotateIntegrationClientSecretAction,
  setIntegrationApplicationStatusAction,
  type IntegrationActionState,
} from "./actions";
import styles from "./Integrations.module.css";

const INITIAL_INTEGRATION_ACTION_STATE: IntegrationActionState = {
  status: "idle",
};

function Feedback({
  state,
  locale,
}: {
  state: IntegrationActionState;
  locale: SupportedLocale;
}) {
  const copy = integrationManagementMessages(locale);
  if (state.status === "idle") return null;
  const success = state.status === "success";
  const message = success
    ? state.operation === "create" ? copy.registered
      : state.operation === "rotate" ? copy.secretRotated
        : state.operation === "disconnect" ? copy.disconnected
          : copy.actionSuccess
    : copy.actionError;
  return <div
    className={success ? styles.feedbackSuccess : styles.feedbackError}
    role={success ? "status" : "alert"}
  >
    <strong>{message}</strong>
    {success && state.credential ? <dl className={styles.credential}>
      {state.credential.clientId ? <>
        <dt>{copy.clientId}</dt>
        <dd><code dir="ltr">{state.credential.clientId}</code></dd>
      </> : null}
      {state.credential.clientSecret ? <>
        <dt>{copy.clientSecret} · {copy.oneTime}</dt>
        <dd><code dir="ltr">{state.credential.clientSecret}</code></dd>
      </> : state.operation === "create" ? <p>{copy.noSecret}</p> : null}
    </dl> : null}
  </div>;
}

export function ApplicationRegistrationForm({ locale }: { locale: SupportedLocale }) {
  const copy = integrationManagementMessages(locale);
  const [state, action, pending] = useActionState(
    createIntegrationApplicationAction,
    INITIAL_INTEGRATION_ACTION_STATE,
  );
  const [clientType, setClientType] = useState<"CONFIDENTIAL" | "PUBLIC">("CONFIDENTIAL");
  return <form action={action} className={styles.registrationForm} aria-busy={pending}>
    <Feedback state={state} locale={locale} />
    <div className={styles.formGrid}>
      <label>{copy.name}<span className={styles.required}>{copy.required}</span>
        <input name="name" required minLength={2} maxLength={120} autoComplete="off" />
      </label>
      <label>{copy.slug}<span className={styles.required}>{copy.required}</span>
        <input name="slug" required minLength={3} maxLength={64} pattern="[a-z][a-z0-9-]+[a-z0-9]" placeholder="approved-app" autoCapitalize="none" autoComplete="off" dir="ltr" />
      </label>
      <label className={styles.fullField}>{copy.appDescription}
        <textarea name="description" maxLength={1000} />
      </label>
      <label>{copy.clientType}
        <select name="clientType" value={clientType} onChange={(event) => setClientType(event.target.value === "PUBLIC" ? "PUBLIC" : "CONFIDENTIAL")}>
          <option value="CONFIDENTIAL">{copy.confidential}</option>
          <option value="PUBLIC">{copy.public}</option>
        </select>
      </label>
      <div className={styles.readOnlyField}>
        <span>{copy.authMethod}</span>
        <code dir="ltr">{clientType === "PUBLIC" ? "none" : "client_secret_basic"}</code>
      </div>
      <label className={styles.fullField}>{copy.redirectUris}<span className={styles.required}>{copy.required}</span>
        <textarea name="redirectUris" required rows={3} placeholder="https://example.test/oauth/callback" dir="ltr" aria-describedby="redirect-uri-help" />
        <small id="redirect-uri-help">{copy.redirectHelp}</small>
      </label>
    </div>
    <fieldset className={styles.scopeFieldset}>
      <legend>{copy.allowedScopes}</legend>
      <div className={styles.scopeOptions}>
        {INTEGRATION_SCOPES.map((scope) => <label key={scope}>
          <input type="checkbox" name="allowedScopes" value={scope} />
          <span>{copy.scopesText[scope]}<code dir="ltr">{scope}</code></span>
        </label>)}
      </div>
    </fieldset>
    <div className={styles.formActions}>
      <button className="button button-primary" type="submit" disabled={pending}>
        <KeyRound size={17} aria-hidden="true" />
        {pending ? `${copy.register}…` : copy.register}
      </button>
    </div>
  </form>;
}

export function ApplicationControls({
  applicationId,
  status,
  confidential,
  locale,
}: {
  applicationId: string;
  status: "ACTIVE" | "INACTIVE";
  confidential: boolean;
  locale: SupportedLocale;
}) {
  const copy = integrationManagementMessages(locale);
  const [rotateState, rotateAction, rotating] = useActionState(
    rotateIntegrationClientSecretAction,
    INITIAL_INTEGRATION_ACTION_STATE,
  );
  const [statusState, statusAction, updating] = useActionState(
    setIntegrationApplicationStatusAction,
    INITIAL_INTEGRATION_ACTION_STATE,
  );
  return <div className={styles.controlStack}>
    {confidential && status === "ACTIVE" ? <form action={rotateAction} aria-busy={rotating} className={styles.confirmForm}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <label className={styles.confirmLabel}>
        <input type="checkbox" name="confirmation" value="yes" required />
        <span>{copy.rotateConfirm}</span>
      </label>
      <button className="button button-secondary" type="submit" disabled={rotating}>
        <RotateCcw size={16} aria-hidden="true" />{copy.rotate}
      </button>
      <Feedback state={rotateState} locale={locale} />
    </form> : null}
    <form action={statusAction} aria-busy={updating} className={styles.confirmForm}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <input type="hidden" name="active" value={status === "ACTIVE" ? "false" : "true"} />
      {status === "ACTIVE" ? <label className={styles.confirmLabel}>
        <input type="checkbox" name="confirmation" value="yes" required />
        <span>{copy.disconnectConfirm}</span>
      </label> : <input type="hidden" name="confirmation" value="yes" />}
      <button className={status === "ACTIVE" ? "button button-danger" : "button button-secondary"} type="submit" disabled={updating}>
        <Power size={16} aria-hidden="true" />{status === "ACTIVE" ? copy.deactivate : copy.activate}
      </button>
      <Feedback state={statusState} locale={locale} />
    </form>
  </div>;
}

export function DisconnectControl({
  connectionId,
  locale,
}: {
  connectionId: string;
  locale: SupportedLocale;
}) {
  const copy = integrationManagementMessages(locale);
  const [state, action, pending] = useActionState(
    disconnectIntegrationAction,
    INITIAL_INTEGRATION_ACTION_STATE,
  );
  return <form action={action} aria-busy={pending} className={styles.confirmForm}>
    <input type="hidden" name="connectionId" value={connectionId} />
    <label className={styles.confirmLabel}>
      <input type="checkbox" name="confirmation" value="yes" required />
      <span>{copy.disconnectConfirm}</span>
    </label>
    <button className="button button-danger" type="submit" disabled={pending}>
      <Unplug size={16} aria-hidden="true" />{copy.disconnect}
    </button>
    <Feedback state={state} locale={locale} />
  </form>;
}
