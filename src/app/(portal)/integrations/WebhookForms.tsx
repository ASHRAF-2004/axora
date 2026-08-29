"use client";

import type { SupportedLocale } from "@/lib/i18n";
import { INTEGRATION_EVENT_TYPES } from "@/lib/integrations/events";
import { integrationManagementMessages } from "@/lib/integrations/management-i18n";
import { KeyRound, Plus, RefreshCw, RotateCcw, Unplug } from "lucide-react";
import { useActionState } from "react";
import {
  createWebhookSubscriptionAction,
  retryWebhookDeliveryAction,
  revokeWebhookSubscriptionAction,
  rotateWebhookCredentialAction,
  type WebhookActionState,
} from "./actions";
import styles from "./Integrations.module.css";

const INITIAL_WEBHOOK_STATE:WebhookActionState={status:"idle"};

function WebhookFeedback({state,locale}:{
  state:WebhookActionState;locale:SupportedLocale;
}){
  const copy=integrationManagementMessages(locale);
  if(state.status==="idle")return null;
  const success=state.status==="success";
  const message=success
    ? state.operation==="create"?copy.webhookCreated
      :state.operation==="rotate"?copy.webhookRotated
        :state.operation==="revoke"?copy.webhookRevoked:copy.webhookRetryQueued
    :copy.webhookActionError;
  return <div className={success?styles.feedbackSuccess:styles.feedbackError}
    role={success?"status":"alert"}>
    <strong>{message}</strong>
    {success&&state.credential?<div className={styles.credential}>
      <dl>
        <dt>{copy.webhookSigningSecret} · {copy.oneTime}</dt>
        <dd><code dir="ltr">{state.credential.secret}</code></dd>
        <dt>{copy.webhookCredentialVersion}</dt>
        <dd><bdi dir="ltr">{state.credential.version}</bdi></dd>
      </dl>
      <p>{copy.webhookSecretHelp}</p>
    </div>:null}
  </div>;
}

export function WebhookSubscriptionForm({locale,connections}:{
  locale:SupportedLocale;
  connections:Array<{id:string;applicationName:string;companyName:string}>;
}){
  const copy=integrationManagementMessages(locale);
  const [state,action,pending]=useActionState(
    createWebhookSubscriptionAction,INITIAL_WEBHOOK_STATE,
  );
  return <form action={action} className={styles.registrationForm} aria-busy={pending}>
    <WebhookFeedback state={state} locale={locale}/>
    <div className={styles.formGrid}>
      <label>{copy.webhookConnection}<span className={styles.required}>{copy.required}</span>
        <select name="connectionId" required defaultValue="">
          <option value="" disabled>{copy.webhookChooseConnection}</option>
          {connections.map((connection)=><option value={connection.id} key={connection.id}>
            {connection.applicationName} · {connection.companyName}
          </option>)}
        </select>
      </label>
      <label>{copy.webhookEndpoint}<span className={styles.required}>{copy.required}</span>
        <input name="endpointUrl" type="url" inputMode="url" required
          minLength={9} maxLength={2048} autoComplete="off" autoCapitalize="none"
          spellCheck={false} dir="ltr" placeholder="https://hooks.example.org/axora"/>
      </label>
    </div>
    <p className={styles.connectHelp}>{copy.webhookEndpointHelp}</p>
    <fieldset className={styles.scopeFieldset}>
      <legend>{copy.webhookEvents}</legend>
      <div className={styles.scopeOptions}>
        {INTEGRATION_EVENT_TYPES.map((eventType)=><label key={eventType}>
          <input type="checkbox" name="eventTypes" value={eventType}/>
          <span>{copy.webhookEventsText[eventType]}<code dir="ltr">{eventType}</code></span>
        </label>)}
      </div>
    </fieldset>
    <div className={styles.formActions}>
      <button className="button button-primary" type="submit" disabled={pending}>
        <Plus size={17} aria-hidden="true"/>
        {pending?`${copy.webhookCreate}…`:copy.webhookCreate}
      </button>
    </div>
  </form>;
}

export function WebhookSubscriptionControls({
  locale,subscriptionId,companyId,canRotate,
}:{
  locale:SupportedLocale;subscriptionId:string;companyId:string;canRotate:boolean;
}){
  const copy=integrationManagementMessages(locale);
  const [rotateState,rotateAction,rotating]=useActionState(
    rotateWebhookCredentialAction,INITIAL_WEBHOOK_STATE,
  );
  const [revokeState,revokeAction,revoking]=useActionState(
    revokeWebhookSubscriptionAction,INITIAL_WEBHOOK_STATE,
  );
  return <div className={styles.controlStack}>
    {canRotate?<form action={rotateAction} aria-busy={rotating} className={styles.confirmForm}>
      <input type="hidden" name="subscriptionId" value={subscriptionId}/>
      <input type="hidden" name="companyId" value={companyId}/>
      <label className={styles.confirmLabel}>
        <input type="checkbox" name="confirmation" value="yes" required/>
        <span>{copy.webhookRotateConfirm}</span>
      </label>
      <button className="button button-secondary" type="submit" disabled={rotating}>
        <RotateCcw size={16} aria-hidden="true"/>{copy.webhookRotate}
      </button>
      <WebhookFeedback state={rotateState} locale={locale}/>
    </form>:null}
    <form action={revokeAction} aria-busy={revoking} className={styles.confirmForm}>
      <input type="hidden" name="subscriptionId" value={subscriptionId}/>
      <input type="hidden" name="companyId" value={companyId}/>
      <label className={styles.confirmLabel}>
        <input type="checkbox" name="confirmation" value="yes" required/>
        <span>{copy.webhookRevokeConfirm}</span>
      </label>
      <button className="button button-danger" type="submit" disabled={revoking}>
        <Unplug size={16} aria-hidden="true"/>{copy.webhookRevoke}
      </button>
      <WebhookFeedback state={revokeState} locale={locale}/>
    </form>
  </div>;
}

export function WebhookRetryControl({locale,deliveryId,companyId}:{
  locale:SupportedLocale;deliveryId:string;companyId:string;
}){
  const copy=integrationManagementMessages(locale);
  const [state,action,pending]=useActionState(
    retryWebhookDeliveryAction,INITIAL_WEBHOOK_STATE,
  );
  return <form action={action} aria-busy={pending} className={styles.confirmForm}>
    <input type="hidden" name="deliveryId" value={deliveryId}/>
    <input type="hidden" name="companyId" value={companyId}/>
    <label className={styles.confirmLabel}>
      <input type="checkbox" name="confirmation" value="yes" required/>
      <span>{copy.webhookRetryConfirm}</span>
    </label>
    <button className="button button-secondary" type="submit" disabled={pending}>
      {pending?<RefreshCw size={16} aria-hidden="true"/>:<KeyRound size={16} aria-hidden="true"/>}
      {copy.webhookRetry}
    </button>
    <WebhookFeedback state={state} locale={locale}/>
  </form>;
}
