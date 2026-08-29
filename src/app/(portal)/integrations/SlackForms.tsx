"use client";

import type { SupportedLocale } from "@/lib/i18n";
import { slackIntegrationMessages } from "@/lib/integrations/slack-i18n";
import {
  SLACK_NOTIFICATION_EVENTS,
  type SlackNotificationEvent,
} from "@/lib/integrations/slack-provider";
import { MessageSquare, RefreshCw, RotateCcw, Save } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { DisconnectControl } from "./IntegrationForms";
import {
  configureSlackNotificationsAction,
  retrySlackDeliveryAction,
  syncSlackChannelsAction,
  type SlackActionState,
} from "./actions";
import styles from "./Integrations.module.css";

const INITIAL_SLACK_STATE:SlackActionState={status:"idle"};

function SlackFeedback({state,locale}:{
  state:SlackActionState;locale:SupportedLocale;
}) {
  const copy=slackIntegrationMessages(locale);
  if(state.status==="idle")return null;
  const message=state.status==="error"?copy.actionError
    :state.operation==="sync"?copy.synced
      :state.operation==="configure"?copy.configured:copy.retryQueued;
  return <div
    className={state.status==="success"?styles.feedbackSuccess:styles.feedbackError}
    role={state.status==="success"?"status":"alert"}
  ><strong>{message}</strong></div>;
}

export function SlackInstallationControls({
  locale,installationId,connectionId,channels,enabledEventTypes,
}:{
  locale:SupportedLocale;
  installationId:string;
  connectionId:string;
  channels:Array<{id:string;name:string;isMember:boolean;isArchived:boolean}>;
  enabledEventTypes:SlackNotificationEvent[];
}) {
  const copy=slackIntegrationMessages(locale);
  const [syncState,syncAction,syncing]=useActionState(
    syncSlackChannelsAction,INITIAL_SLACK_STATE,
  );
  const [configureState,configureAction,configuring]=useActionState(
    configureSlackNotificationsAction,INITIAL_SLACK_STATE,
  );
  const available=channels.filter((channel)=>channel.isMember&&!channel.isArchived);
  return <div className={styles.controlStack}>
    <form action={syncAction} aria-busy={syncing} className={styles.confirmForm}>
      <input type="hidden" name="installationId" value={installationId}/>
      <p className={styles.connectHelp}>{copy.syncHelp}</p>
      <button className="button button-secondary" type="submit" disabled={syncing}>
        <RefreshCw size={16} aria-hidden="true"/>{copy.syncChannels}
      </button>
      <SlackFeedback state={syncState} locale={locale}/>
    </form>
    {available.length?<form action={configureAction}
      aria-busy={configuring} className={styles.registrationForm}>
      <input type="hidden" name="installationId" value={installationId}/>
      <div className={styles.formGrid}>
        <label className={styles.fullField}>{copy.channel}
          <select name="channelId" required defaultValue="">
            <option value="" disabled>{copy.chooseChannel}</option>
            {available.map((channel)=><option value={channel.id} key={channel.id}>
              #{channel.name}
            </option>)}
          </select>
        </label>
      </div>
      <fieldset className={styles.scopeFieldset}>
        <legend>{copy.enabledEvents}</legend>
        <div className={styles.scopeOptions}>
          {SLACK_NOTIFICATION_EVENTS.map((eventType)=><label key={eventType}>
            <input type="checkbox" name="eventTypes" value={eventType}
              defaultChecked={enabledEventTypes.includes(eventType)}/>
            <span>{copy.eventText[eventType]}<code dir="ltr">{eventType}</code></span>
          </label>)}
        </div>
      </fieldset>
      <div className={styles.formActions}>
        <button className="button button-primary" type="submit" disabled={configuring}>
          <Save size={16} aria-hidden="true"/>{copy.savePreferences}
        </button>
      </div>
      <SlackFeedback state={configureState} locale={locale}/>
    </form>:null}
    <div className={styles.slackDisconnect}>
      <p className={styles.connectHelp}>{copy.disconnectHelp}</p>
      <DisconnectControl connectionId={connectionId} locale={locale}/>
    </div>
  </div>;
}

export function SlackRetryControl({locale,deliveryId,companyId}:{
  locale:SupportedLocale;deliveryId:string;companyId:string;
}) {
  const copy=slackIntegrationMessages(locale);
  const [state,action,pending]=useActionState(
    retrySlackDeliveryAction,INITIAL_SLACK_STATE,
  );
  return <form action={action} aria-busy={pending} className={styles.confirmForm}>
    <input type="hidden" name="deliveryId" value={deliveryId}/>
    <input type="hidden" name="companyId" value={companyId}/>
    <label className={styles.confirmLabel}>
      <input type="checkbox" name="confirmation" value="yes" required/>
      <span>{copy.retryConfirm}</span>
    </label>
    <button className="button button-secondary" type="submit" disabled={pending}>
      {pending?<RefreshCw size={16} aria-hidden="true"/>
        :<RotateCcw size={16} aria-hidden="true"/>}{copy.retry}
    </button>
    <SlackFeedback state={state} locale={locale}/>
  </form>;
}

export function ConnectSlackControl({locale}:{locale:SupportedLocale}) {
  const copy=slackIntegrationMessages(locale);
  return <div className={styles.slackConnect}>
    <p>{copy.connectHelp}</p>
    <Link className="button button-primary"
      href="/api/integrations/slack/oauth/start" prefetch={false}>
      <MessageSquare size={17} aria-hidden="true"/>{copy.connect}
    </Link>
  </div>;
}
