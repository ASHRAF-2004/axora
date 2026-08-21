import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";

import { requirePagePermission } from "@/lib/auth";
import { getCompanyWalletWorkspace } from "@/lib/company-wallet";
import { formatMoneyDecimal } from "@/lib/money-decimal";
import { topUpStatusLabel, walletMessages } from "@/lib/wallet-i18n";

import {
  recordWalletTopUpAction,
  requestWalletTopUpAction,
} from "./actions";
import styles from "./Wallet.module.css";

function dateTime(value: Date, locale: string, timeZone: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(value);
}

export default async function CompanyWalletPage({
  searchParams,
}: {
  searchParams: Promise<{
    company?: string;
    outcome?: string;
    error?: string;
  }>;
}) {
  const actor = await requirePagePermission("view_wallet");
  if (!actor.roleAssignmentId && process.env.DEMO_MODE === "false") {
    redirect("/access-denied");
  }
  const parameters = await searchParams;
  const locale = actor.preferredLocale ?? "en";
  const timeZone = actor.timezone ?? "Asia/Kuala_Lumpur";
  const messages = walletMessages(locale);
  const workspace = await getCompanyWalletWorkspace(
    actor,
    actor.isOwner ? undefined : actor.companyId,
  );
  const selectedWallet = workspace.wallets.find((wallet) => (
    wallet.companyId === parameters.company
  )) ?? workspace.wallets[0];
  const today = new Date().toISOString().slice(0, 10);
  const outcome = parameters.outcome === "requested"
    ? messages.topUpRequested
    : parameters.outcome === "recorded"
      ? messages.topUpRecorded
      : parameters.outcome === "already-recorded"
        ? messages.topUpAlreadyRecorded
        : undefined;
  const error = parameters.error === "invalid"
    ? messages.invalidSubmission
    : parameters.error
      ? messages.unavailable
      : undefined;

  return (
    <main className={styles.page} dir={locale === "ar" ? "rtl" : "ltr"}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>{messages.companyWallet}</p>
        <h1>{messages.companyWallet}</h1>
        <p>{messages.walletIntro}</p>
        <p className={styles.fundsNote}>{messages.walletFundsNote}</p>
      </header>

      {outcome ? <p className={styles.successNotice} role="status">{outcome}</p> : null}
      {error ? <p className={styles.errorNotice} role="alert">{error}</p> : null}

      {actor.isOwner && workspace.wallets.length > 1 ? (
        <form method="get" className={styles.companySelector}>
          <label htmlFor="wallet-company">{messages.selectCompany}</label>
          <select id="wallet-company" name="company" defaultValue={selectedWallet?.companyId}>
            {workspace.wallets.map((wallet) => (
              <option key={wallet.companyId} value={wallet.companyId}>{wallet.companyName}</option>
            ))}
          </select>
          <button type="submit">{messages.openCompanyWallet}</button>
        </form>
      ) : null}

      {!selectedWallet ? (
        <section className={styles.panel}><p>{messages.noWallets}</p></section>
      ) : (
        <>
          <section className={styles.balanceCard} aria-labelledby="wallet-balance-title">
            <div>
              <p>{selectedWallet.companyName}</p>
              <h2 id="wallet-balance-title">{messages.availableBalance}</h2>
            </div>
            <strong>{formatMoneyDecimal(
              selectedWallet.availableBalance,
              selectedWallet.currency,
              locale,
            )}</strong>
          </section>

          <section className={styles.panel} aria-labelledby="wallet-top-ups-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="wallet-top-ups-title">{messages.topUps}</h2>
                <p>{selectedWallet.canRequestTopUp
                  ? messages.requestTopUpIntro
                  : messages.recordTopUpIntro}</p>
              </div>
            </div>

            <div className={styles.formGrid}>
              {selectedWallet.canRequestTopUp ? (
                <form action={requestWalletTopUpAction} className={styles.financeForm}>
                  <h3>{messages.requestTopUp}</h3>
                  <input type="hidden" name="companyId" value={selectedWallet.companyId} />
                  <input type="hidden" name="commandId" value={randomUUID()} />
                  <label>
                    <span>{messages.amount} ({selectedWallet.currency})</span>
                    <input name="amount" inputMode="decimal" autoComplete="off" min="0.01" step="0.01" required />
                  </label>
                  <label>
                    <span>{messages.reference}</span>
                    <input name="reference" maxLength={200} autoComplete="off" />
                  </label>
                  <label>
                    <span>{messages.optionalNote}</span>
                    <textarea name="note" maxLength={1000} />
                  </label>
                  <button type="submit">{messages.submitTopUpRequest}</button>
                </form>
              ) : null}

              {selectedWallet.canRecordTopUp ? (
                <form action={recordWalletTopUpAction} className={styles.financeForm}>
                  <h3>{messages.directTopUp}</h3>
                  <p>{messages.recordTopUpIntro}</p>
                  <input type="hidden" name="companyId" value={selectedWallet.companyId} />
                  <input type="hidden" name="commandId" value={randomUUID()} />
                  <label>
                    <span>{messages.amount} ({selectedWallet.currency})</span>
                    <input name="amount" inputMode="decimal" autoComplete="off" min="0.01" step="0.01" required />
                  </label>
                  <label>
                    <span>{messages.receivedDate}</span>
                    <input name="effectiveDate" type="date" defaultValue={today} max={today} required />
                  </label>
                  <label>
                    <span>{messages.reference}</span>
                    <input name="reference" minLength={3} maxLength={200} autoComplete="off" required />
                  </label>
                  <label>
                    <span>{messages.reason}</span>
                    <textarea name="reason" minLength={3} maxLength={1000} required />
                  </label>
                  <button type="submit">{messages.recordReceivedTopUp}</button>
                </form>
              ) : null}
            </div>

            {selectedWallet.topUpRequests.length === 0 ? (
              <p className={styles.empty}>{messages.noTopUpRequests}</p>
            ) : (
              <ul className={styles.topUpList}>
                {selectedWallet.topUpRequests.map((request) => (
                  <li key={request.id}>
                    <div className={styles.topUpSummary}>
                      <div>
                        <strong>{formatMoneyDecimal(request.amount, request.currency, locale)}</strong>
                        <span>{topUpStatusLabel(locale, request.status)}</span>
                      </div>
                      <p>{messages.requestedOn}: {dateTime(request.requestedAt, locale, timeZone)}</p>
                      {request.reference ? <p>{messages.reference}: {request.reference}</p> : null}
                    </div>
                    {selectedWallet.canRecordTopUp && request.status !== "RECEIVED" ? (
                      <form action={recordWalletTopUpAction} className={styles.inlineRecordForm}>
                        <input type="hidden" name="companyId" value={selectedWallet.companyId} />
                        <input type="hidden" name="topUpRequestId" value={request.id} />
                        <input type="hidden" name="commandId" value={randomUUID()} />
                        <label>
                          <span>{messages.amount} ({request.currency})</span>
                          <input name="amount" inputMode="decimal" defaultValue={request.amount} min="0.01" step="0.01" required />
                        </label>
                        <label>
                          <span>{messages.receivedDate}</span>
                          <input name="effectiveDate" type="date" defaultValue={today} max={today} required />
                        </label>
                        <label>
                          <span>{messages.reference}</span>
                          <input name="reference" minLength={3} maxLength={200} defaultValue={request.reference ?? ""} required />
                        </label>
                        <label>
                          <span>{messages.reason}</span>
                          <textarea name="reason" minLength={3} maxLength={1000} required />
                        </label>
                        <button type="submit">{messages.recordReceivedTopUp}</button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.panel} aria-labelledby="wallet-ledger-title">
            <div className={styles.sectionHeader}>
              <div>
                <h2 id="wallet-ledger-title">{messages.ledger}</h2>
                <p>{messages.walletFundsNote}</p>
              </div>
            </div>
            {selectedWallet.ledger.length === 0 ? (
              <p className={styles.empty}>{messages.noLedgerEntries}</p>
            ) : (
              <div className={styles.tableWrap}>
                <table>
                  <thead>
                    <tr>
                      <th>{messages.transactionType}</th>
                      <th>{messages.reference}</th>
                      <th>{messages.reason}</th>
                      <th>{messages.postedOn}</th>
                      <th>{messages.amount}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedWallet.ledger.map((entry) => (
                      <tr key={entry.id}>
                        <td>{messages.ledgerTypes[entry.type]}</td>
                        <td>{entry.reference}</td>
                        <td>{entry.reason}</td>
                        <td>{dateTime(entry.postedAt, locale, timeZone)}</td>
                        <td className={entry.amountDelta.startsWith("-") ? styles.debit : styles.credit}>
                          {formatMoneyDecimal(entry.amountDelta, entry.currency, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}
