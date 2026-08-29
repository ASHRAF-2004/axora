import { requirePagePermission } from "@/lib/auth";
import { externalApiEnabled } from "@/lib/integrations/config";
import { getIntegrationWorkspace } from "@/lib/integrations/management";
import { integrationManagementMessages } from "@/lib/integrations/management-i18n";
import {
  Activity,
  AppWindow,
  CheckCircle2,
  CircleOff,
  KeyRound,
  Link2,
  ShieldCheck,
} from "lucide-react";
import type { Metadata } from "next";
import {
  ApplicationControls,
  ApplicationRegistrationForm,
  DisconnectControl,
} from "./IntegrationForms";
import styles from "./Integrations.module.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Integrations",
  robots: { index: false, follow: false, noarchive: true },
};

export default async function IntegrationsPage() {
  const actor = await requirePagePermission("manage_company_integrations");
  const locale = actor.preferredLocale ?? "en";
  const copy = integrationManagementMessages(locale);
  const workspace = await getIntegrationWorkspace(actor);
  const apiActive = externalApiEnabled();
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

  return <div className={styles.workspace}>
    <header className={styles.pageHeader}>
      <div>
        <p className={styles.eyebrow}>{copy.eyebrow}</p>
        <h1>{copy.title}</h1>
        <p className={styles.description}>{copy.description}</p>
      </div>
      <div className={styles.featureStatus} data-active={String(apiActive)}>
        {apiActive
          ? <CheckCircle2 size={18} aria-hidden="true" />
          : <CircleOff size={18} aria-hidden="true" />}
        <span>{apiActive ? copy.apiActive : copy.apiInactive}</span>
      </div>
    </header>

    {!apiActive ? <div className={styles.darkLaunchNotice} role="status">
      <ShieldCheck size={18} aria-hidden="true" />
      <span>{copy.apiInactiveHelp}</span>
    </div> : null}

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

    <section className={styles.panel} aria-labelledby="connections-title">
      <header className={styles.panelHeader}>
        <div><h2 id="connections-title">{copy.connectedApps}</h2><p>{copy.connectedDescription}</p></div>
        <Link2 size={21} aria-hidden="true" />
      </header>
      {workspace.connections.length ? <div className={styles.cardList}>
        {workspace.connections.map((connection) => <article className={styles.connectionCard} key={connection.id}>
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
      {workspace.applications.length ? <div className={styles.cardList}>
        {workspace.applications.map((application) => <article className={styles.applicationCard} key={application.id}>
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
