"use client";

import { setBranchActiveAction } from "@/app/(portal)/branches/actions";
import { useActionState } from "react";

const initialState = { status: "idle", message: "" } as const;

export function BranchActiveButton({ branchId, active, copy }: {
  branchId: string;
  active: boolean;
  copy: { deactivate: string; activate: string; unavailable: string; activeDelivery: string; activeCart: string; activeRequest: string };
}) {
  const [state, action, pending] = useActionState(setBranchActiveAction, initialState);
  const message = state.message === "ACTIVE_DELIVERY" ? copy.activeDelivery
    : state.message === "ACTIVE_CART" ? copy.activeCart
      : state.message === "ACTIVE_REQUEST" ? copy.activeRequest : copy.unavailable;
  return <form action={action} aria-busy={pending}>
    <input name="branchId" type="hidden" value={branchId} />
    <input name="active" type="hidden" value={String(!active)} />
    <button className="button button-secondary" type="submit" disabled={pending}>{active ? copy.deactivate : copy.activate}</button>
    {state.status === "error" ? <p className="form-alert" role="alert">{message}</p> : null}
  </form>;
}
