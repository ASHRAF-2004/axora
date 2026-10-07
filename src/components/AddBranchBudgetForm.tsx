"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { addBranchBudgetAction, type AddBranchBudgetActionState } from "@/app/(portal)/branches/actions";
import type { SupportedLocale } from "@/lib/i18n";
import { branchBudgetRefusalMessages, branchBudgetRefusalMessage } from "@/lib/branch-budget-refusal-i18n";
import { formatMoneyDecimal } from "@/lib/money-decimal";

const initialState: AddBranchBudgetActionState = { status: "idle", message: "" };

type Props = { branchId: string; locale: SupportedLocale; copy: {
  add: string; amount: string; help: string; cancel: string; adding: string;
  success: string; invalid: string; unavailable: string;
} };

export function AddBranchBudgetForm({ branchId, locale, copy }: Props) {
  const [open, setOpen] = useState(false);
  if (!open) return <button className="button button-primary" type="button" onClick={() => setOpen(true)}>{copy.add}</button>;
  // Mount a new command only when the user intentionally starts a new add.
  // Errors/retries retain the same payload/ID; successful commands cannot be
  // accidentally submitted again by editing the just-completed form.
  return <BudgetCommandForm branchId={branchId} locale={locale} copy={copy} close={() => setOpen(false)} />;
}

function BudgetCommandForm({ branchId,locale,copy,close }: Props & { close: () => void }) {
  const [commandId] = useState(() => crypto.randomUUID());
  const [amount, setAmount] = useState("");
  const [state, action, pending] = useActionState(addBranchBudgetAction, initialState);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => { if (state.status === "error") errorRef.current?.focus(); }, [state]);
  const reasons = branchBudgetRefusalMessages(locale);
  const message = state.status === "success" ? copy.success
    : state.code === "INVALID" ? copy.invalid
      : state.code ? branchBudgetRefusalMessage(locale,state.code) : copy.unavailable;
  return <form action={action} className="stack-sm" aria-busy={pending} noValidate>
    <input name="branchId" type="hidden" value={branchId} />
    <input name="commandId" type="hidden" value={commandId} />
    <label>{copy.amount} <span className="input-with-prefix"><span>MYR</span><input name="amount" type="text" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" autoComplete="off" required disabled={pending || state.status === "success"} aria-invalid={state.status === "error" && ["INVALID","CEILING_EXCEEDED"].includes(state.code ?? "")} aria-describedby={state.status === "error" ? "branch-budget-help branch-budget-error" : "branch-budget-help"} /></span></label>
    <small id="branch-budget-help">{copy.help}</small>
    {state.status !== "idle" ? <p id="branch-budget-error" ref={errorRef} tabIndex={-1} className={state.status === "success" ? "form-success" : "form-alert"} role={state.status === "success" ? "status" : "alert"}>{message}</p> : null}
    {state.status === "error" && state.code === "CEILING_EXCEEDED" && state.limits ? <dl className="information-list metric-information-list">
      {(["ceiling","allocated","headroom"] as const).map((key) => <div key={key}><dt>{reasons[key]}</dt><dd><bdi>{formatMoneyDecimal(state.limits![key],"MYR",locale)}</bdi></dd></div>)}
    </dl> : null}
    <div className="form-actions"><button className="button button-secondary" type="button" disabled={pending} onClick={close}>{copy.cancel}</button><button className="button button-primary" type="submit" disabled={pending || state.status === "success"}>{pending ? copy.adding : copy.add}</button></div>
  </form>;
}
