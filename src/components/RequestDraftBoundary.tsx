"use client";

import type { ReactNode } from "react";
import { useEffect, useRef } from "react";
import type { BrowserSessionScope } from "@/lib/browser-session-scope";
import { clearRequestCart } from "@/lib/request-cart";
import {
  clearRequestDraft,
  newRequestSubmissionKey,
  readRequestDraft,
  writeRequestDraft,
} from "@/lib/request-draft";

const REQUEST_TYPES = new Set(["Standard", "Ad-hoc", "Recurring"]);
const URGENCIES = new Set(["Low", "Normal", "High", "Urgent"]);

function localToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 10);
}

function setNativeValue(
  control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype = control instanceof HTMLSelectElement
    ? HTMLSelectElement.prototype
    : control instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(control, value);
  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function formControl(
  form: HTMLFormElement,
  name: string,
) {
  const value = form.elements.namedItem(name);
  return value instanceof HTMLInputElement
    || value instanceof HTMLSelectElement
    || value instanceof HTMLTextAreaElement
    ? value
    : null;
}

function ensureSubmissionInput(form: HTMLFormElement, submissionKey: string) {
  const existing = formControl(form, "submissionKey");
  if (existing instanceof HTMLInputElement) {
    existing.value = submissionKey;
    return;
  }
  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "submissionKey";
  input.value = submissionKey;
  input.dataset.requestSubmissionKey = "true";
  form.append(input);
}

function selectedOptionExists(control: HTMLSelectElement, value: string) {
  return [...control.options].some((option) => option.value === value);
}

export function RequestDraftBoundary({
  scope,
  children,
}: {
  scope: BrowserSessionScope;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const form = rootRef.current?.querySelector<HTMLFormElement>("form");
    if (!form) return;

    const stored = readRequestDraft(scope);
    const submissionKey = stored?.submissionKey ?? newRequestSubmissionKey();
    ensureSubmissionInput(form, submissionKey);

    if (stored) {
      const requestType = formControl(form, "requestType");
      if (requestType instanceof HTMLSelectElement
        && REQUEST_TYPES.has(stored.requestType)
        && selectedOptionExists(requestType, stored.requestType)) {
        setNativeValue(requestType, stored.requestType);
      }

      const urgency = formControl(form, "urgency");
      if (urgency instanceof HTMLSelectElement
        && URGENCIES.has(stored.urgency)
        && selectedOptionExists(urgency, stored.urgency)) {
        setNativeValue(urgency, stored.urgency);
      }

      const notes = formControl(form, "notes");
      if (notes) setNativeValue(notes, stored.notes);
    }

    const persist = () => {
      const branch = formControl(form, "branchId")?.value ?? "";
      const neededByDate = formControl(form, "neededByDate")?.value
        || localToday();
      const requestTypeValue = formControl(form, "requestType")?.value
        || "Standard";
      const urgencyValue = formControl(form, "urgency")?.value || "Normal";
      const notes = formControl(form, "notes")?.value ?? "";
      writeRequestDraft({
        branchId: branch,
        neededByDate,
        requestType: REQUEST_TYPES.has(requestTypeValue)
          ? requestTypeValue as "Standard" | "Ad-hoc" | "Recurring"
          : "Standard",
        urgency: URGENCIES.has(urgencyValue)
          ? urgencyValue as "Low" | "Normal" | "High" | "Urgent"
          : "Normal",
        notes,
        submissionKey,
      }, scope);
    };
    const schedulePersist = persist;

    form.addEventListener("input", schedulePersist);
    form.addEventListener("change", schedulePersist);
    if (!stored) {
      persist();
    }

    return () => {
      persist();
      form.removeEventListener("input", schedulePersist);
      form.removeEventListener("change", schedulePersist);
    };
  }, [scope]);

  return <div ref={rootRef} data-request-draft-boundary="true">{children}</div>;
}

export function RequestDraftCleanup({
  scope,
}: {
  scope: BrowserSessionScope;
}) {
  useEffect(() => {
    clearRequestCart(scope);
    clearRequestDraft(scope);
  }, [scope]);
  return null;
}

export const requestDraftBoundaryInternals = {
  localToday,
  selectedOptionExists,
};
