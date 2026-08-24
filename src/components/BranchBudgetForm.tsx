"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { configureFirstBranchBudgetAction, type BudgetActionState } from "@/app/(portal)/budgets/[branchId]/actions";
import { branchBudgetMessages } from "@/lib/branch-budget-i18n";
import type { SupportedLocale } from "@/lib/i18n";

const initialState: BudgetActionState = { status: "idle", message: "", submissionId: "" };

export function BranchBudgetForm({ branchId, locale, today }: { branchId: string; locale: SupportedLocale; today: string }) {
  const copy = branchBudgetMessages(locale);
  const [cycle, setCycle] = useState("MONTHLY");
  const [commandId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(configureFirstBranchBudgetAction, initialState);
  return <form action={action} className="panel form-panel" aria-busy={pending} noValidate>
    <input type="hidden" name="branchId" value={branchId} /><input type="hidden" name="commandId" value={commandId} />
    <h2>{copy.setTitle}</h2>
    <div className="form-grid">
      <label>{copy.amount}<span className="input-with-prefix"><span>RM</span><input name="amount" type="number" inputMode="decimal" min="0.01" max="100000000" step="0.01" required /></span></label>
      <label>{copy.cycle}<select name="cycle" value={cycle} onChange={(event) => setCycle(event.target.value)}><option value="MONTHLY">{copy.monthly}</option><option value="YEARLY">{copy.yearly}</option><option value="CUSTOM">{copy.custom}</option></select></label>
      <label>{copy.startDate}<input name="startDate" type="date" min={today} max={today} defaultValue={today} required /></label>
      {cycle === "CUSTOM" ? <label>{copy.customEndDate}<input name="customEndDate" type="date" min={today} required /></label> : <input type="hidden" name="customEndDate" value="" />}
    </div>
    <p className="callout">{copy.immutable}</p>
    {state.status !== "idle" ? <p className={state.status === "success" ? "form-success" : "form-alert"} role={state.status === "success" ? "status" : "alert"}>{state.message}{state.status === "funding" ? <> <Link href="/wallet">{copy.openWallet}</Link></> : null}</p> : null}
    <div className="form-actions"><button className="button button-primary" type="submit" disabled={pending || state.status === "success"}>{pending ? copy.saving : copy.save}</button></div>
  </form>;
}
