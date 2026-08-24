"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import {
  saveBranchDeliveryLocationAction,
  type BranchDeliveryLocationActionState,
} from "@/app/(portal)/branches/[branchId]/delivery-location/actions";
import { BranchDeliveryLocationPicker, type DeliveryLocationSelection } from "@/components/BranchDeliveryLocationPicker";
import { branchDeliveryLocationMessages } from "@/lib/branch-delivery-location-i18n";
import type { SupportedLocale } from "@/lib/i18n";

const initialActionState: BranchDeliveryLocationActionState = {
  status: "idle",
  message: "",
  submissionId: "",
};

function sameSelection(left: DeliveryLocationSelection | null, right: DeliveryLocationSelection | null) {
  return Boolean(left && right
    && left.latitude === right.latitude
    && left.longitude === right.longitude
    && left.addressLabel === right.addressLabel);
}

export function BranchDeliveryLocationForm({
  addressLabel,
  branchId,
  commandId: initialCommandId,
  coordinates: initialCoordinates,
  instructions,
  locale = "en",
  providerAttribution,
  providerId,
  providerPlaceId,
}: {
  addressLabel: string;
  branchId: string;
  commandId: string;
  coordinates: { latitude: number; longitude: number } | null;
  instructions?: string;
  locale?: SupportedLocale;
  providerAttribution?: string;
  providerId?: string;
  providerPlaceId?: string;
}) {
  const copy = branchDeliveryLocationMessages(locale);
  const router = useRouter();
  const instructionsRef = useRef<HTMLTextAreaElement>(null);
  const initialSelection = initialCoordinates ? {
    ...initialCoordinates,
    addressLabel,
    providerId: providerId ?? "legacy",
    ...(providerPlaceId ? { providerPlaceId } : {}),
    ...(providerAttribution ? { providerAttribution } : {}),
  } : null;
  const [confirmedSelection, setConfirmedSelection] = useState<DeliveryLocationSelection | null>(initialSelection);
  const [draftSelection, setDraftSelection] = useState<DeliveryLocationSelection | null>(initialSelection);
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
    if (state.field === "instructions") instructionsRef.current?.focus();
  }, [router, state]);

  const coordinatesReady = sameSelection(draftSelection, confirmedSelection);
  const instructionsInvalid = state.status === "error" && state.field === "instructions";

  return <form action={formAction} className="panel form-panel" aria-busy={pending} noValidate>
    <input name="branchId" type="hidden" value={branchId} />
    <input name="commandId" type="hidden" value={initialCommandId} />
    <input name="addressLabel" type="hidden" value={confirmedSelection?.addressLabel ?? ""} />
    <input name="latitude" type="hidden" value={confirmedSelection?.latitude.toFixed(6) ?? ""} />
    <input name="longitude" type="hidden" value={confirmedSelection?.longitude.toFixed(6) ?? ""} />
    <input name="providerId" type="hidden" value={confirmedSelection?.providerId ?? ""} />
    <input name="providerPlaceId" type="hidden" value={confirmedSelection?.providerPlaceId ?? ""} />
    <input name="providerAttribution" type="hidden" value={confirmedSelection?.providerAttribution ?? ""} />

    <BranchDeliveryLocationPicker
      locale={locale}
      initialSelection={initialSelection}
      disabled={pending}
      onDraftChange={setDraftSelection}
      onConfirm={(selection) => {
        setConfirmedSelection(selection);
        setDraftSelection(selection);
      }}
    />
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
    {!coordinatesReady ? <p className="form-alert" role="alert">{copy.confirmationRequired}</p> : null}
    {state.status !== "idle"
      ? <p className={state.status === "success" ? "form-success" : "form-alert"} role={state.status === "success" ? "status" : "alert"}>{state.message}</p>
      : null}
    <div className="form-actions">
      <button className="button button-primary" type="submit" disabled={pending || !coordinatesReady || !confirmedSelection}>
        {pending ? copy.saving : copy.save}
      </button>
    </div>
  </form>;
}
