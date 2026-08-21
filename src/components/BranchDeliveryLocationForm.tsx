"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import {
  saveBranchDeliveryLocationAction,
  type BranchDeliveryLocationActionState,
} from "@/app/(portal)/branches/[branchId]/delivery-location/actions";
import { BranchDeliveryLocationPicker } from "@/components/BranchDeliveryLocationPicker";
import { branchDeliveryLocationMessages } from "@/lib/branch-delivery-location-i18n";
import type { DeliveryCoordinates } from "@/lib/delivery-navigation";
import type { SupportedLocale } from "@/lib/i18n";

const initialActionState: BranchDeliveryLocationActionState = {
  status: "idle",
  message: "",
  submissionId: "",
};

function sameCoordinates(left: DeliveryCoordinates | null, right: DeliveryCoordinates | null) {
  return Boolean(left && right
    && left.latitude === right.latitude
    && left.longitude === right.longitude);
}

export function BranchDeliveryLocationForm({
  addressLabel,
  branchId,
  commandId: initialCommandId,
  coordinates: initialCoordinates,
  instructions,
  locale = "en",
}: {
  addressLabel: string;
  branchId: string;
  commandId: string;
  coordinates: DeliveryCoordinates | null;
  instructions?: string;
  locale?: SupportedLocale;
}) {
  const copy = branchDeliveryLocationMessages(locale);
  const router = useRouter();
  const addressRef = useRef<HTMLTextAreaElement>(null);
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [confirmedCoordinates, setConfirmedCoordinates] = useState<DeliveryCoordinates | null>(initialCoordinates);
  const [draftCoordinates, setDraftCoordinates] = useState<DeliveryCoordinates | null>(initialCoordinates);
  const [state, formAction, pending] = useActionState(
    saveBranchDeliveryLocationAction,
    initialActionState,
  );

  useEffect(() => {
    if (!state.submissionId) return;
    if (state.status === "success") {
      router.refresh();
      return;
    }
    if (state.field === "addressLabel") addressRef.current?.focus();
    if (state.field === "instructions") instructionsRef.current?.focus();
    if (state.field === "reason") reasonRef.current?.focus();
  }, [router, state]);

  const coordinatesReady = sameCoordinates(draftCoordinates, confirmedCoordinates);
  const addressInvalid = state.status === "error" && state.field === "addressLabel";
  const instructionsInvalid = state.status === "error" && state.field === "instructions";
  const reasonInvalid = state.status === "error" && state.field === "reason";

  return <form action={formAction} className="panel form-panel" aria-busy={pending} noValidate>
    <input name="branchId" type="hidden" value={branchId} />
    <input name="commandId" type="hidden" value={initialCommandId} />
    <input name="latitude" type="hidden" value={confirmedCoordinates?.latitude.toFixed(6) ?? ""} />
    <input name="longitude" type="hidden" value={confirmedCoordinates?.longitude.toFixed(6) ?? ""} />

    <BranchDeliveryLocationPicker
      locale={locale}
      initialCoordinates={initialCoordinates}
      disabled={pending}
      onDraftChange={setDraftCoordinates}
      onConfirm={(coordinates) => {
        setConfirmedCoordinates(coordinates);
        setDraftCoordinates(coordinates);
      }}
    />

    <label>
      {copy.addressLabel}
      <textarea
        ref={addressRef}
        name="addressLabel"
        defaultValue={addressLabel}
        minLength={3}
        maxLength={5_000}
        required
        aria-invalid={addressInvalid}
        aria-describedby="branch-delivery-address-help"
      />
      <small id="branch-delivery-address-help">{copy.addressHelp}</small>
    </label>
    <label>
      {copy.instructions}
      <textarea
        ref={instructionsRef}
        name="instructions"
        defaultValue={instructions}
        maxLength={5_000}
        aria-invalid={instructionsInvalid}
        aria-describedby="branch-delivery-instructions-help"
      />
      <small id="branch-delivery-instructions-help">{copy.instructionsHelp}</small>
    </label>
    <label>
      {copy.reason}
      <textarea
        ref={reasonRef}
        name="reason"
        minLength={3}
        maxLength={1_000}
        required
        aria-invalid={reasonInvalid}
        aria-describedby="branch-delivery-reason-help"
      />
      <small id="branch-delivery-reason-help">{copy.reasonHelp}</small>
    </label>

    {!coordinatesReady ? <p className="form-alert" role="alert">{copy.confirmationRequired}</p> : null}
    {state.status !== "idle"
      ? <p className={state.status === "success" ? "form-success" : "form-alert"} role={state.status === "success" ? "status" : "alert"}>{state.message}</p>
      : null}
    <div className="form-actions">
      <button className="button button-primary" type="submit" disabled={pending || !coordinatesReady || !confirmedCoordinates}>
        {pending ? copy.saving : copy.save}
      </button>
    </div>
  </form>;
}
