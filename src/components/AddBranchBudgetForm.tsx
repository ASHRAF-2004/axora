"use client";

import { useActionState, useState } from "react";

import { addBranchBudgetAction, type AddBranchBudgetActionState } from "@/app/(portal)/branches/actions";

const initialState: AddBranchBudgetActionState = { status: "idle", message: "" };

export function AddBranchBudgetForm({ branchId, copy }: { branchId: string; copy: {
  add: string; amount: string; help: string; cancel: string; adding: string;
  success: string; invalid: string; unavailable: string;
} }) {
  const [open, setOpen] = useState(false);
  const [commandId, setCommandId] = useState(() => crypto.randomUUID());
  const [state, action, pending] = useActionState(addBranchBudgetAction, initialState);
  if (!open) return <button className="button button-primary" type="button" onClick={() => {
    setCommandId(crypto.randomUUID()); setOpen(true);
  }}>{copy.add}</button>;
  const message = state.status === "success" ? copy.success
    : state.message === "INVALID_AMOUNT" ? copy.invalid : copy.unavailable;
  return <form action={action} className="stack-sm" aria-busy={pending} noValidate>
    <input name="branchId" type="hidden" value={branchId} />
    <input name="commandId" type="hidden" value={commandId} />
    <label>{copy.amount} <span className="input-with-prefix"><span>MYR</span><input name="amount" type="text" inputMode="decimal" pattern="[0-9]+([.][0-9]{1,2})?" autoComplete="off" required aria-describedby="branch-budget-help" /></span></label>
    <small id="branch-budget-help">{copy.help}</small>
    {state.status !== "idle" ? <p className={state.status === "success" ? "form-success" : "form-alert"} role={state.status === "success" ? "status" : "alert"}>{message}</p> : null}
    <div className="form-actions"><button className="button button-secondary" type="button" disabled={pending} onClick={() => setOpen(false)}>{copy.cancel}</button><button className="button button-primary" type="submit" disabled={pending}>{pending ? copy.adding : copy.add}</button></div>
  </form>;
}
