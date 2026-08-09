"use client";

import {
  revealEmailRecipientAction,
  type RecipientRevealState,
} from "@/app/(portal)/email-operations/actions";
import type { EmailDeliveryKind } from "@/lib/email-operations";
import { Eye } from "lucide-react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";

const initialState: RecipientRevealState = { status: "idle" };

function RevealButton({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return <button className="button button-secondary" type="submit" disabled={pending} aria-busy={pending}>
    <Eye size={16} aria-hidden="true" />{pending ? pendingLabel : label}
  </button>;
}

export function EmailRecipientReveal({
  commandId,
  deliveryKind,
  deliveryId,
  labels,
}: {
  commandId: string;
  deliveryKind: EmailDeliveryKind;
  deliveryId: string;
  labels: {
    reveal: string;
    revealing: string;
    reason: string;
    revealed: string;
    invalid: string;
    unavailable: string;
  };
}) {
  const [state, action] = useActionState(revealEmailRecipientAction, initialState);
  return <div>
    <form action={action} className="email-reveal-form" data-ux-silent="true">
      <input type="hidden" name="commandId" value={commandId} />
      <input type="hidden" name="deliveryKind" value={deliveryKind} />
      <input type="hidden" name="deliveryId" value={deliveryId} />
      <label>{labels.reason}<input name="reason" minLength={10} maxLength={1_000} required autoComplete="off" /></label>
      <RevealButton label={labels.reveal} pendingLabel={labels.revealing} />
    </form>
    {state.status === "revealed" && state.recipient ? <div className="callout callout-success" role="status">
      <strong>{labels.revealed}</strong><bdi className="bidi-ltr" dir="ltr">{state.recipient}</bdi>
    </div> : null}
    {state.status === "invalid" ? <div className="callout callout-warning" role="alert">{labels.invalid}</div> : null}
    {state.status === "unavailable" ? <div className="callout callout-warning" role="alert">{labels.unavailable}</div> : null}
  </div>;
}
