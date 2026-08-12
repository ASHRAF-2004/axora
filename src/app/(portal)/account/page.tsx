import { PageHeader } from "@/components/PageHeader";
import { PasswordField } from "@/components/PasswordField";
import { SecuritySubmitButton } from "@/components/SecuritySubmitButton";
import { getAccountSecurityOverview } from "@/lib/account-security";
import { requireAccountLifecycleSession } from "@/lib/auth";
import { accountLifecycleMessages, formatAccountDateTime } from "@/lib/account-lifecycle-i18n";
import { LOCALE_NAMES } from "@/lib/i18n";
import {
  BellRing,
  CheckCircle2,
  KeyRound,
  Laptop,
  MailCheck,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import {
  changePasswordAction,
  resendEmailVerificationAction,
  revokeAllOtherSessionsAction,
  revokeSessionAction,
} from "./actions";
import styles from "./AccountSecurity.module.css";

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const actor = await requireAccountLifecycleSession();
  const [overview, search] = await Promise.all([
    getAccountSecurityOverview(actor),
    searchParams,
  ]);
  const locale = overview.preferredLocale;
  const copy = accountLifecycleMessages(locale).account;
  const formatDate = (value: string) => formatAccountDateTime(value, locale, overview.timezone);
  const key = typeof search.security === "string" ? search.security : "";
  const message = copy.feedback[key];
  const otherSessionCount = overview.activeSessions.filter((session) => !session.isCurrent).length;

  return <div lang={locale} dir={LOCALE_NAMES[locale].dir}>
    <PageHeader
      eyebrow={copy.eyebrow}
      title={copy.title}
      description={copy.description}
    />

    {message ? (
      <div
        className={`${message.kind === "success" ? "form-success" : "form-alert"} ${styles.notice}`}
        role={message.kind === "success" ? "status" : "alert"}
      >
        {message.kind === "success" ? <CheckCircle2 size={18} /> : <ShieldAlert size={18} />}
        {message.message}
      </div>
    ) : null}
    <section className={styles.overviewGrid} aria-label={copy.overviewLabel}>
      <article className={`${styles.card} ${styles.summaryCard}`}>
        <span className={styles.summaryIcon}><MailCheck size={20} /></span>
        <div><span>{copy.emailStatus}</span><strong>{overview.emailVerifiedAt ? copy.verified : copy.verificationRequired}</strong></div>
      </article>
      <article className={`${styles.card} ${styles.summaryCard}`}>
        <span className={styles.summaryIcon}><Laptop size={20} /></span>
        <div><span>{copy.activeSessions}</span><strong>{overview.activeSessions.length}</strong></div>
      </article>
      <article className={`${styles.card} ${styles.summaryCard}`}>
        <span className={styles.summaryIcon}><BellRing size={20} /></span>
        <div><span>{copy.unreadNotifications}</span><strong>{overview.unreadNotifications}</strong></div>
      </article>
    </section>

    <div className={styles.securityGrid}>
      <section className={styles.card} aria-labelledby="change-password-title">
        <header className={styles.cardHeader}>
          <KeyRound size={22} />
          <div>
            <h2 id="change-password-title">{copy.changePassword}</h2>
            <p>{copy.changePasswordBody}</p>
          </div>
        </header>
        <form action={changePasswordAction} className={styles.form} data-ux-silent="true">
          <PasswordField
            id="account-current-password"
            name="currentPassword"
            label={copy.currentPassword}
            showLabel={copy.showPassword}
            hideLabel={copy.hidePassword}
            autoComplete="current-password"
          />
          <PasswordField
            id="account-new-password"
            name="newPassword"
            label={copy.newPassword}
            showLabel={copy.showPassword}
            hideLabel={copy.hidePassword}
            autoComplete="new-password"
            describedBy="account-password-help"
            enforceNewPasswordPolicy
            tooShortMessage={copy.passwordTooShort}
            tooLongMessage={copy.passwordTooLong}
          />
          <PasswordField
            id="account-new-password-confirmation"
            name="confirmPassword"
            label={copy.confirmPassword}
            showLabel={copy.showPassword}
            hideLabel={copy.hidePassword}
            autoComplete="new-password"
            describedBy="account-password-help"
            enforceNewPasswordPolicy
            tooShortMessage={copy.passwordTooShort}
            tooLongMessage={copy.passwordTooLong}
          />
          <div className={styles.formActions}>
            <span id="account-password-help" className={styles.helper}>{copy.passwordHelp}</span>
            <SecuritySubmitButton label={copy.changePassword} pendingLabel={copy.changingPassword} />
          </div>
        </form>
      </section>

      <section className={styles.card} aria-labelledby="verification-title">
        <header className={styles.cardHeader}>
          <ShieldCheck size={22} />
          <div>
            <h2 id="verification-title">{copy.emailNotifications}</h2>
            <p>{copy.securityLinksBody}</p>
          </div>
        </header>
        <div className={styles.verificationStatus}>
          <span className={styles.helper}>{copy.accountEmail}</span>
          <strong>{overview.email}</strong>
          <span className={styles.helper}>
            {overview.emailVerifiedAt
              ? copy.verifiedAt(formatDate(overview.emailVerifiedAt))
              : copy.notVerified}
          </span>
        </div>
        {!overview.emailVerifiedAt ? (
          <div className={`${styles.verificationActions} ${styles.verification}`}>
            <span className={styles.helper}>{copy.newestVerification}</span>
            <form action={resendEmailVerificationAction}>
              <input type="hidden" name="locale" value={overview.preferredLocale} />
              <button className="button button-secondary" type="submit">{copy.sendVerification}</button>
            </form>
          </div>
        ) : null}
        <div className={`${styles.verificationStatus} ${styles.verification}`}>
          <strong>{copy.delivery}</strong>
          <span className={styles.helper}>{copy.inApp}: {overview.inAppNotifications ? copy.enabled : copy.disabled} · {copy.email}: {overview.emailNotifications ? copy.enabled : copy.disabled}</span>
          <span className={styles.helper}>{copy.notificationHelp}</span>
        </div>
      </section>

      <section className={`${styles.card} ${styles.sessionsCard}`} aria-labelledby="sessions-title">
        <header className={styles.cardHeader}>
          <Laptop size={22} />
          <div>
            <h2 id="sessions-title">{copy.sessionsTitle}</h2>
            <p>{copy.sessionsBody}</p>
          </div>
        </header>
        <div className={styles.sessionList}>
          {overview.activeSessions.map((session) => (
            <article className={styles.sessionRow} key={session.id}>
              <div>
                <div className={styles.sessionTitle}>
                  <strong>{session.userAgentSummary || copy.browserSession}</strong>
                  {session.isCurrent ? <span className={styles.badge}>{copy.current}</span> : null}
                </div>
                <div className={styles.sessionMeta}>
                  {copy.sessionMeta(formatDate(session.lastSeenAt), formatDate(session.expiresAt))}
                </div>
              </div>
              {!session.isCurrent ? (
                <form action={revokeSessionAction}>
                  <input type="hidden" name="sessionId" value={session.id} />
                  <button className="button button-secondary" type="submit">{copy.endSession}</button>
                </form>
              ) : null}
            </article>
          ))}
        </div>
        <div className={styles.sessionActions}>
          <span className={styles.helper}>{otherSessionCount ? copy.otherSessions(otherSessionCount) : copy.noOtherSessions}</span>
          <form action={revokeAllOtherSessionsAction}>
            <button className="button button-secondary" type="submit" disabled={!otherSessionCount}>{copy.endAll}</button>
          </form>
        </div>
      </section>
    </div>
  </div>;
}
