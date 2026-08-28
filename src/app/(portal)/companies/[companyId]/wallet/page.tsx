import { CompanyWorkspaceNav } from "@/components/CompanyWorkspaceNav";
import { WalletDetail } from "@/app/(portal)/wallet/WalletDetail";
import { requirePagePermission } from "@/lib/auth";
import { getCompanyWalletWorkspace } from "@/lib/company-wallet";
import { findAuthorizedCompanyLifecycleRecord, loadCompanyLifecycleWorkspace } from "@/lib/company-lifecycle";
import { walletMessages } from "@/lib/wallet-i18n";
import { notFound, redirect } from "next/navigation";

export default async function CompanyWalletPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ outcome?: string; error?: string }>;
}) {
  const actor = await requirePagePermission("view_wallet");
  if (!actor.isOwner) redirect("/access-denied");
  const locale = actor.preferredLocale ?? "en";
  const timeZone = actor.timezone ?? "Asia/Kuala_Lumpur";
  const messages = walletMessages(locale);
  const { companyId } = await params;
  const company = findAuthorizedCompanyLifecycleRecord(await loadCompanyLifecycleWorkspace(actor), companyId);
  if (!company) notFound();
  const workspace = await getCompanyWalletWorkspace(actor, company.id);
  const wallet = workspace.wallets.find((item) => item.companyId === company.id);
  if (!wallet) notFound();
  const result = await searchParams;
  const outcome = result.outcome === "recorded" ? messages.topUpRecorded
    : result.outcome === "already-recorded" ? messages.topUpAlreadyRecorded
      : undefined;
  const error = result.error === "invalid" ? messages.invalidSubmission
    : result.error ? messages.unavailable : undefined;
  return <>
    <CompanyWorkspaceNav companyId={company.id} locale={locale} active="wallet" />
    <WalletDetail wallet={wallet} locale={locale} timeZone={timeZone} messages={messages} outcome={outcome} error={error} />
  </>;
}
