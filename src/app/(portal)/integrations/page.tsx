import { requirePagePermission } from "@/lib/auth";
import { externalApiEnabled, integrationWebhooksEnabled } from "@/lib/integrations/config";
import { getIntegrationWorkspace } from "@/lib/integrations/management";
import { integrationManagementMessages } from "@/lib/integrations/management-i18n";
import { getSlackWorkspace } from "@/lib/integrations/slack";
import { slackIntegrationMessages } from "@/lib/integrations/slack-i18n";
import { getWebhookWorkspace } from "@/lib/integrations/webhooks";
import {
  Activity,
  AppWindow,
  CheckCircle2,
  CircleOff,
  KeyRound,
  Link2,
  MessageSquare,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import type { Metadata } from "next";
import {
  ApplicationControls,
  ApplicationRegistrationForm,
  DisconnectControl,
} from "./IntegrationForms";
import styles from "./Integrations.module.css";
import {
  ConnectSlackControl,
  SlackInstallationControls,
  SlackRetryControl,
} from "./SlackForms";
import {
  WebhookRetryControl,
  WebhookSubscriptionControls,
  WebhookSubscriptionForm,
} from "./WebhookForms";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Integrations",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function IntegrationsPage({searchParams}:{
  searchParams:Promise<{slack?:string}>;
}) {
  const actor = await requirePagePermission("manage_company_integrations");
  const locale = actor.preferredLocale ?? "en";
  const copy = integrationManagementMessages(locale);
  const slackCopy=slackIntegrationMessages(locale);
  const query=await searchParams;
  const workspace = await getIntegrationWorkspace(actor);
  const slackWorkspace=await getSlackWorkspace(actor);
  const apiActive = externalApiEnabled();
  const webhooksActive = integrationWebhooksEnabled();
  const webhookWorkspace = webhooksActive
    ? await getWebhookWorkspace(actor)
    : undefined;
  const number = new Intl.NumberFormat(locale);
  const date = new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: actor.timezone ?? "Asia/Kuala_Lumpur",
  });
  const metricEntries = workspace.operations ? [
    [copy.activeApplications, workspace.operations.activeApplications],
    [copy.activeConnections, workspace.operations.activeConnections],
    [copy.activeGrants, workspace.operations.activeGrants],
    [copy.activeTokens, workspace.operations.activeAccessTokens],
    [copy.requests24h, workspace.operations.apiRequests24h],
    [copy.errors24h, workspace.operations.apiErrors24h],
  ] as const : [];
  const webhookMetricEntries = webhookWorkspace?.operations ? [
    [copy.webhookEvents24h,webhookWorkspace.operations.eventCount24h],
    [copy.webhookPending,webhookWorkspace.operations.pendingDeliveries],
    [copy.webhookRetrying,webhookWorkspace.operations.retryDeliveries],
    [copy.webhookDead,webhookWorkspace.operations.deadDeliveries],
    [copy.webhookSucceeded24h,webhookWorkspace.operations.succeeded24h],
  ] as const:[];
  const slackMetricEntries=slackWorkspace.operations?[
    [slackCopy.activeInstallations,slackWorkspace.operations.activeInstallations],
    [slackCopy.pendingDeliveries,slackWorkspace.operations.pendingDeliveries],
    [slackCopy.retryDeliveries,slackWorkspace.operations.retryDeliveries],
    [slackCopy.deadDeliveries,slackWorkspace.operations.deadDeliveries],
    [slackCopy.succeeded24h,slackWorkspace.operations.succeeded24h],
  ] as const:[];
  const oauthApplications=workspace.applications.filter(
    (application)=>application.authorizationMode==="AXORA_OAUTH",
  );
  const oauthApplicationIds=new Set(oauthApplications.map((application)=>application.id));
  const oauthConnections=workspace.connections.filter(
    (connection)=>oauthApplicationIds.has(connection.applicationId),
  );
  const currentSlackInstallation=slackWorkspace.installations.find(
    (installation)=>installation.status!=="REVOKED",
  );
  const slackNotice=query.slack==="connected"?slackCopy.connected
    :query.slack==="cancelled"?slackCopy.cancelled
      :query.slack==="session_required"?slackCopy.sessionRequired
        :query.slack==="error"?slackCopy.oauthError:undefined;
  const slackNoticeError=query.slack==="error"||query.slack==="session_required";

  return <div className={styles.workspace}>
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className={styles.description}>{copy.description}</p>
      </div>
      <div className={styles.featureStatuses}>
        <div className={styles.featureStatus} data-active={String(apiActive)}>
          {apiActive
            ? <CheckCircle2 size={18} aria-hidden="true" />
            : <CircleOff size={18} aria-hidden="true" />}
          <span>{apiActive ? copy.apiActive : copy.apiInactive}</span>
        </div>
        <div className={styles.featureStatus} data-active={String(webhooksActive)}>
          {webhooksActive
            ? <CheckCircle2 size={18} aria-hidden="true" />
            : <CircleOff size={18} aria-hidden="true" />}
          <span>{webhooksActive?copy.webhooksActive:copy.webhooksInactive}</span>
        </div>
        <div className={styles.featureStatus}
          data-active={String(slackWorkspace.enabled&&slackWorkspace.configured)}>
          {slackWorkspace.enabled&&slackWorkspace.configured
            ? <CheckCircle2 size={18} aria-hidden="true" />
            : <CircleOff size={18} aria-hidden="true" />}
          <span>{!slackWorkspace.enabled?slackCopy.featureInactive
            :slackWorkspace.configured?slackCopy.featureActive
              :slackCopy.featureUnavailable}</span>
        </div>
      </div>
    </header>

    {!apiActive ? <div className={styles.darkLaunchNotice} role="status">
      <ShieldCheck size={18} aria-hidden="true" />
      <span>{copy.apiInactiveHelp}</span>
    </div> : null}
    {!webhooksActive?<div className={styles.darkLaunchNotice} role="status">
      <Webhook size={18} aria-hidden="true"/>
      <span>{copy.webhooksInactiveHelp}</span>
    </div>:null}
    {!slackWorkspace.enabled?<div className={styles.darkLaunchNotice} role="status">
      <MessageSquare size={18} aria-hidden="true"/>
      <span>{slackCopy.inactiveHelp}</span>
    </div>:slackWorkspace.configured?null:<div className={styles.darkLaunchNotice} role="status">
      <MessageSquare size={18} aria-hidden="true"/>
      <span>{slackCopy.unconfiguredHelp}</span>
    </div>}
    {slackNotice?<div className={slackNoticeError?styles.feedbackError:styles.feedbackSuccess}
      role={slackNoticeError?"alert":"status"}><strong>{slackNotice}</strong></div>:null}

    {workspace.operations ? <section aria-labelledby="integration-health-title">
      <div className={styles.sectionHeading}>
        <Activity size={20} aria-hidden="true" />
        <h2 id="integration-health-title">{copy.operationalHealth}</h2>
      </div>
      <div className={styles.metricGrid}>
        {metricEntries.map(([label, value]) => <article className={styles.metricCard} key={label}>
          <span>{label}</span><strong><bdi dir="ltr">{number.format(value)}</bdi></strong>
        </article>)}
      </div>
    </section> : null}

    {webhookMetricEntries.length?<section aria-labelledby="webhook-health-title">
      <div className={styles.sectionHeading}>
        <Webhook size={20} aria-hidden="true"/>
        <h2 id="webhook-health-title">{copy.webhookHealth}</h2>
      </div>
      <div className={styles.metricGrid}>
        {webhookMetricEntries.map(([label,value])=><article className={styles.metricCard} key={label}>
          <span>{label}</span><strong><bdi dir="ltr">{number.format(value)}</bdi></strong>
        </article>)}
      </div>
    </section>:null}

    {slackMetricEntries.length?<section aria-labelledby="slack-health-title">
      <div className={styles.sectionHeading}>
        <MessageSquare size={20} aria-hidden="true"/>
        <h2 id="slack-health-title">{slackCopy.health}</h2>
      </div>
      <div className={styles.metricGrid}>
        {slackMetricEntries.map(([label,value])=><article
          className={styles.metricCard} key={label}>
          <span>{label}</span><strong><bdi dir="ltr">{number.format(value)}</bdi></strong>
        </article>)}
      </div>
    </section>:null}

    <section className={styles.panel} aria-labelledby="connections-title">
      <header className={styles.panelHeader}>
        <div><h2 id="connections-title">{copy.connectedApps}</h2><p>{copy.connectedDescription}</p></div>
        <Link2 size={21} aria-hidden="true" />
      </header>
      {oauthConnections.length ? <div className={styles.cardList}>
        {oauthConnections.map((connection) => <article className={styles.connectionCard} key={connection.id}>
          <div className={styles.cardIdentity}>
            <span className={styles.iconBox}><AppWindow size={20} aria-hidden="true" /></span>
            <div><h3>{connection.applicationName}</h3><p>{connection.companyName}</p></div>
            <span className={styles.badge} data-status={connection.status.toLowerCase()}>
              {connection.status === "ACTIVE" ? copy.active : copy.revoked}
            </span>
          </div>
          <dl className={styles.detailGrid}>
            <div><dt>{copy.connectedBy}</dt><dd>{connection.connectedBy ?? "—"}</dd></div>
            <div><dt>{copy.connectedAt}</dt><dd><time dateTime={connection.connectedAt}>{date.format(new Date(connection.connectedAt))}</time></dd></div>
            {workspace.mode === "OWNER" ? <div><dt>{copy.company}</dt><dd>{connection.companyName}</dd></div> : null}
          </dl>
          <div className={styles.scopeList} aria-label={copy.scopes}>
            {connection.scopes.map((scope) => <span key={scope}><bdi dir="ltr">{scope}</bdi></span>)}
          </div>
          {connection.status === "ACTIVE" ? <details className={styles.manageDetails}>
            <summary>{copy.manage}</summary>
            <DisconnectControl connectionId={connection.id} locale={locale} />
          </details> : null}
        </article>)}
      </div> : <div className={styles.emptyState}><CircleOff size={25} aria-hidden="true" /><strong>{copy.noConnections}</strong></div>}
    </section>

    {workspace.mode === "COMPANY" ? <section className={styles.panel} aria-labelledby="available-title">
      <header className={styles.panelHeader}>
        <div><h2 id="available-title">{copy.availableApps}</h2><p>{copy.availableDescription}</p></div>
        <AppWindow size={21} aria-hidden="true" />
      </header>
      {oauthApplications.length ? <div className={styles.cardList}>
        {oauthApplications.map((application) => <article className={styles.applicationCard} key={application.id}>
          <div className={styles.cardIdentity}>
            <span className={styles.iconBox}><AppWindow size={20} aria-hidden="true" /></span>
            <div><h3>{application.name}</h3><p>{application.description}</p></div>
          </div>
          <div className={styles.scopeList} aria-label={copy.allowedScopes}>
            {application.allowedScopes.map((scope) => <span key={scope}>{copy.scopesText[scope]}</span>)}
          </div>
          <p className={styles.connectHelp}>{copy.connectHelp}</p>
        </article>)}
      </div> : <div className={styles.emptyState}><CircleOff size={25} aria-hidden="true" /><strong>{copy.noApplications}</strong></div>}
    </section> : null}

    <section className={styles.panel} aria-labelledby="slack-title">
      <header className={styles.panelHeader}>
        <div><h2 id="slack-title">{slackCopy.title}</h2><p>{slackCopy.description}</p></div>
        <MessageSquare size={21} aria-hidden="true"/>
      </header>
      {slackWorkspace.installations.length?<div className={styles.cardList}>
        {slackWorkspace.installations.map((installation)=><article
          className={styles.connectionCard} key={installation.id}>
          <div className={styles.cardIdentity}>
            <span className={styles.iconBox}><MessageSquare size={20} aria-hidden="true"/></span>
            <div><h3>{installation.workspaceName}</h3><p>{installation.companyName}</p></div>
            <span className={styles.badge} data-status={installation.status.toLowerCase()}>
              {slackCopy.statusText[
                installation.status.toLowerCase() as keyof typeof slackCopy.statusText
              ]}
            </span>
          </div>
          <dl className={styles.detailGrid}>
            <div><dt>{slackCopy.workspace}</dt><dd>{installation.workspaceName}</dd></div>
            <div><dt>{slackCopy.channel}</dt><dd>{installation.channelName
              ? <bdi dir="ltr">#{installation.channelName}</bdi>:slackCopy.noChannel}</dd></div>
            <div><dt>{slackCopy.connectedBy}</dt><dd>{installation.installedBy??"—"}</dd></div>
            <div><dt>{slackCopy.connectedAt}</dt><dd><time dateTime={installation.installedAt}>
              {date.format(new Date(installation.installedAt))}
            </time></dd></div>
            {workspace.mode==="OWNER"?<div><dt>{slackCopy.company}</dt><dd>{installation.companyName}</dd></div>:null}
            <div><dt>{slackCopy.lastSync}</dt><dd>{installation.lastChannelSyncAt
              ? <time dateTime={installation.lastChannelSyncAt}>{date.format(new Date(installation.lastChannelSyncAt))}</time>
              :"—"}</dd></div>
          </dl>
          <div className={styles.scopeList} aria-label={slackCopy.enabledEvents}>
            {installation.enabledEventTypes.map((eventType)=><span key={eventType}>
              {slackCopy.eventText[eventType]}
            </span>)}
          </div>
          {installation.status!=="REVOKED"?<details className={styles.manageDetails}>
            <summary>{slackCopy.manage}</summary>
            {workspace.mode==="COMPANY"&&installation.status==="ACTIVE"
              &&slackWorkspace.enabled&&slackWorkspace.configured
              ? <SlackInstallationControls locale={locale}
                installationId={installation.id} connectionId={installation.connectionId}
                channels={slackWorkspace.channels}
                enabledEventTypes={installation.enabledEventTypes}/>
              : <DisconnectControl connectionId={installation.connectionId} locale={locale}/>}
          </details>:null}
        </article>)}
      </div>:workspace.mode==="COMPANY"&&slackWorkspace.enabled&&slackWorkspace.configured
        ? <ConnectSlackControl locale={locale}/>
        : <div className={styles.emptyState}><CircleOff size={25} aria-hidden="true"/>
          <strong>{slackCopy.noInstallations}</strong></div>}
      {workspace.mode==="COMPANY"&&!currentSlackInstallation
        &&slackWorkspace.installations.length>0&&slackWorkspace.enabled&&slackWorkspace.configured
        ? <ConnectSlackControl locale={locale}/>:null}
    </section>

    {slackWorkspace.deliveries.length?<section className={styles.panel}
      aria-labelledby="slack-deliveries-title">
      <header className={styles.panelHeader}>
        <div><h2 id="slack-deliveries-title">{slackCopy.deliveries}</h2>
          <p>{slackCopy.deliveriesDescription}</p></div>
        <Activity size={21} aria-hidden="true"/>
      </header>
      <div className={styles.cardList}>
        {slackWorkspace.deliveries.map((delivery)=><article
          className={styles.connectionCard} key={delivery.id}>
          <div className={styles.cardIdentity}>
            <span className={styles.iconBox}><Activity size={20} aria-hidden="true"/></span>
            <div><h3>{slackCopy.eventText[delivery.eventType]}</h3>
              <p><code dir="ltr">{delivery.id}</code></p></div>
            <span className={styles.badge} data-status={delivery.status.toLowerCase()}>
              {slackCopy.statusText[
                delivery.status.toLowerCase() as keyof typeof slackCopy.statusText
              ]}
            </span>
          </div>
          <dl className={styles.detailGrid}>
            <div><dt>{slackCopy.attempts}</dt><dd><bdi dir="ltr">
              {number.format(delivery.attemptCount)}</bdi></dd></div>
            <div><dt>{slackCopy.lastAttempt}</dt><dd>{delivery.lastAttemptAt
              ? <time dateTime={delivery.lastAttemptAt}>{date.format(new Date(delivery.lastAttemptAt))}</time>
              :"—"}</dd></div>
            <div><dt>{slackCopy.errorCategory}</dt><dd>{delivery.errorCategory
              ? <code dir="ltr">{delivery.errorCategory}</code>:"—"}</dd></div>
          </dl>
          {delivery.status==="DEAD"?<details className={styles.manageDetails}>
            <summary>{slackCopy.manage}</summary>
            <SlackRetryControl locale={locale} deliveryId={delivery.id}
              companyId={delivery.companyId}/>
          </details>:null}
        </article>)}
      </div>
    </section>:null}

    {webhookWorkspace&&workspace.mode==="COMPANY"?<section className={styles.panel} aria-labelledby="webhook-create-title">
      <header className={styles.panelHeader}>
        <div><h2 id="webhook-create-title">{copy.webhookCreateTitle}</h2><p>{copy.webhookCreateDescription}</p></div>
        <Webhook size={21} aria-hidden="true"/>
      </header>
      {webhookWorkspace.availableConnections.length?<div className={styles.registrationDetails}>
        <WebhookSubscriptionForm locale={locale} connections={webhookWorkspace.availableConnections}/>
      </div>:<div className={styles.emptyState}><CircleOff size={25} aria-hidden="true"/><strong>{copy.webhookNoConnections}</strong></div>}
    </section>:null}

    {webhookWorkspace?<section className={styles.panel} aria-labelledby="webhook-subscriptions-title">
      <header className={styles.panelHeader}>
        <div><h2 id="webhook-subscriptions-title">{copy.webhookSubscriptions}</h2><p>{copy.webhookSubscriptionsDescription}</p></div>
        <Webhook size={21} aria-hidden="true"/>
      </header>
      {webhookWorkspace.subscriptions.length?<div className={styles.cardList}>
        {webhookWorkspace.subscriptions.map((subscription)=><article className={styles.connectionCard} key={subscription.id}>
          <div className={styles.cardIdentity}>
            <span className={styles.iconBox}><Webhook size={20} aria-hidden="true"/></span>
            <div><h3>{subscription.applicationName}</h3><p>{subscription.companyName}</p></div>
            <span className={styles.badge} data-status={subscription.status.toLowerCase()}>
              {copy.webhookStatusText[subscription.status.toLowerCase() as keyof typeof copy.webhookStatusText]}
            </span>
          </div>
          <dl className={styles.detailGrid}>
            <div><dt>{copy.webhookEndpointOrigin}</dt><dd><code dir="ltr">{subscription.endpointOrigin}</code></dd></div>
            <div><dt>{copy.webhookAuthorizedBy}</dt><dd>{subscription.authorizedBy??"—"}</dd></div>
            <div><dt>{copy.webhookCreatedAt}</dt><dd><time dateTime={subscription.createdAt}>{date.format(new Date(subscription.createdAt))}</time></dd></div>
            <div><dt>{copy.webhookCredentialVersion}</dt><dd><bdi dir="ltr">{number.format(subscription.credentialVersion)}</bdi></dd></div>
          </dl>
          <div className={styles.scopeList} aria-label={copy.webhookEvents}>
            {subscription.eventTypes.map((eventType)=><span key={eventType}>{copy.webhookEventsText[eventType]}</span>)}
          </div>
          {subscription.status!=="REVOKED"?<details className={styles.manageDetails}>
            <summary>{copy.manage}</summary>
            <WebhookSubscriptionControls locale={locale} subscriptionId={subscription.id}
              companyId={subscription.companyId} canRotate={workspace.mode==="COMPANY"}/>
          </details>:null}
        </article>)}
      </div>:<div className={styles.emptyState}><CircleOff size={25} aria-hidden="true"/><strong>{copy.webhookNoSubscriptions}</strong></div>}
    </section>:null}

    {webhookWorkspace?<section className={styles.panel} aria-labelledby="webhook-deliveries-title">
      <header className={styles.panelHeader}>
        <div><h2 id="webhook-deliveries-title">{copy.webhookDeliveries}</h2><p>{copy.webhookDeliveriesDescription}</p></div>
        <Activity size={21} aria-hidden="true"/>
      </header>
      {webhookWorkspace.deliveries.length?<div className={styles.cardList}>
        {webhookWorkspace.deliveries.map((delivery)=><article className={styles.connectionCard} key={delivery.id}>
          <div className={styles.cardIdentity}>
            <span className={styles.iconBox}><Activity size={20} aria-hidden="true"/></span>
            <div><h3>{copy.webhookEventsText[delivery.eventType]}</h3><p><code dir="ltr">{delivery.resourceUrl}</code></p></div>
            <span className={styles.badge} data-status={delivery.status.toLowerCase()}>
              {copy.webhookStatusText[delivery.status.toLowerCase() as keyof typeof copy.webhookStatusText]}
            </span>
          </div>
          <dl className={styles.detailGrid}>
            <div><dt>{copy.webhookAttempts}</dt><dd><bdi dir="ltr">{number.format(delivery.attemptCount)}</bdi></dd></div>
            <div><dt>{copy.webhookLastAttempt}</dt><dd>{delivery.lastAttemptAt?<time dateTime={delivery.lastAttemptAt}>{date.format(new Date(delivery.lastAttemptAt))}</time>:"—"}</dd></div>
            <div><dt>{copy.webhookErrorCategory}</dt><dd>{delivery.errorCategory?<code dir="ltr">{delivery.errorCategory}</code>:"—"}</dd></div>
          </dl>
          {delivery.status==="DEAD"?<details className={styles.manageDetails}>
            <summary>{copy.manage}</summary>
            <WebhookRetryControl locale={locale} deliveryId={delivery.id} companyId={delivery.companyId}/>
          </details>:null}
        </article>)}
      </div>:<div className={styles.emptyState}><CircleOff size={25} aria-hidden="true"/><strong>{copy.webhookNoDeliveries}</strong></div>}
    </section>:null}

    {workspace.mode === "OWNER" ? <section className={styles.panel} aria-labelledby="registry-title">
      <header className={styles.panelHeader}>
        <div><h2 id="registry-title">{copy.applicationRegistry}</h2><p>{copy.applicationDescription}</p></div>
        <KeyRound size={21} aria-hidden="true" />
      </header>
      <details className={styles.registrationDetails}>
        <summary className="button button-primary">{copy.register}</summary>
        <ApplicationRegistrationForm locale={locale} />
      </details>
      {workspace.applications.length ? <div className={styles.cardList}>
        {workspace.applications.map((application) => <article className={styles.applicationCard} key={application.id}>
          <div className={styles.cardIdentity}>
            <span className={styles.iconBox}><AppWindow size={20} aria-hidden="true" /></span>
            <div><h3>{application.name}</h3><p>{application.description}</p></div>
            <span className={styles.badge} data-status={application.status.toLowerCase()}>
              {application.status === "ACTIVE" ? copy.active : copy.inactive}
            </span>
          </div>
          <dl className={styles.detailGrid}>
            <div><dt>{copy.clientId}</dt><dd><code dir="ltr">{application.clientId}</code></dd></div>
            <div><dt>{copy.clientType}</dt><dd>{application.clientType === "PUBLIC" ? copy.public : copy.confidential}</dd></div>
            <div><dt>{copy.activeConnections}</dt><dd><bdi dir="ltr">{number.format(application.activeConnectionCount)}</bdi></dd></div>
          </dl>
          <div className={styles.scopeList} aria-label={copy.allowedScopes}>
            {application.allowedScopes.map((scope) => <span key={scope}><bdi dir="ltr">{scope}</bdi></span>)}
          </div>
          <details className={styles.metadataDetails}>
            <summary>{copy.redirects}</summary>
            <ul>{application.redirectUris.map((uri) => <li key={uri}><code dir="ltr">{uri}</code></li>)}</ul>
          </details>
          <details className={styles.manageDetails}>
            <summary>{copy.manage}</summary>
            <ApplicationControls
              applicationId={application.id}
              status={application.status}
              confidential={application.clientType === "CONFIDENTIAL"}
              locale={locale}
            />
          </details>
        </article>)}
      </div> : <div className={styles.emptyState}><CircleOff size={25} aria-hidden="true" /><strong>{copy.noApplications}</strong></div>}
    </section> : null}
  </div>;
}
