"use client";

import { updateTutorialStepAction } from "@/app/(portal)/help/actions";
import type { TutorialStepDefinition, TutorialStepStatus } from "@/lib/onboarding";
import { ArrowLeft, ArrowRight, Check, ExternalLink, GraduationCap, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { SupportedLocale } from "@/lib/i18n";
import { portalMessages } from "@/lib/portal-i18n";

interface GuidedStep extends TutorialStepDefinition {
  status: TutorialStepStatus;
}

const targetRoutes: Record<string, string> = {
  dashboard: "/dashboard",
  companies: "/companies",
  operations: "/sourcing",
  audit: "/audit",
  sourcing: "/sourcing",
  deliveries: "/deliveries",
  branches: "/branches",
  people: "/users",
  requests: "/requests",
  shop: "/products",
  cart: "/requests/new",
  approvals: "/approvals",
  finance: "/finance",
  help: "/help",
  receiving: "/receiving",
  "supplier-queue": "/supplier",
  "driver-today": "/driver",
  "system-health": "/support",
  "support-boundary": "/support",
  "support-actions": "/support",
};

function targetKey(selector: string) {
  return selector.match(/data-(?:mobile-)?tour=['\"]([^'\"]+)/)?.[1] ?? "";
}

export function GuidedTutorial({ steps, roleKey, locale }: { steps: GuidedStep[]; roleKey: string; locale: SupportedLocale }) {
  const params = useSearchParams();
  const [open, setOpen] = useState(params.get("tutorial") === "1");
  const firstOpen = useMemo(() => Math.max(0, steps.findIndex((step) => !["COMPLETED", "SKIPPED"].includes(step.status))), [steps]);
  const [index, setIndex] = useState(firstOpen);
  const [pending, startTransition] = useTransition();
  const panelRef = useRef<HTMLElement>(null);
  const step = steps[index];
  const finished = steps.every((item) => ["COMPLETED", "SKIPPED"].includes(item.status));
  const messages = portalMessages(locale).tutorial;

  useEffect(() => {
    if (!open || !step) return;
    const selector = window.matchMedia("(max-width: 760px)").matches && step.mobileTarget ? step.mobileTarget : step.target;
    const target = document.querySelector<HTMLElement>(selector);
    target?.classList.add("tour-target-active");
    target?.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    panelRef.current?.focus();
    if (step.status === "NOT_STARTED") {
      startTransition(() => updateTutorialStepAction({ roleKey, stepKey: step.key, status: "VIEWED" }));
    }
    return () => target?.classList.remove("tour-target-active");
  }, [index, open, roleKey, step]);

  function save(status: TutorialStepStatus, move = true) {
    if (!step) return;
    startTransition(async () => {
      await updateTutorialStepAction({ roleKey, stepKey: step.key, status });
      if (move && index < steps.length - 1) setIndex((current) => current + 1);
      else if (move) setOpen(false);
    });
  }

  if (!steps.length) return null;

  return <>
    {!open ? <button className="tutorial-launcher" type="button" onClick={() => { setIndex(firstOpen); setOpen(true); }} aria-label={messages.open}><GraduationCap size={19} /><span>{finished ? messages.restart : messages.continue}</span></button> : null}
    {open && step ? <aside ref={panelRef} className="tutorial-coach" role="dialog" aria-modal="false" aria-labelledby="tutorial-title" tabIndex={-1} aria-busy={pending}>
      <header><span><GraduationCap size={18} />{messages.roleGuide}</span><button type="button" aria-label={messages.close} onClick={() => save("DISMISSED_TEMPORARILY", false)} disabled={pending}><X size={18} /></button></header>
      <div className="tutorial-progress"><span style={{ width: `${((index + 1) / steps.length) * 100}%` }} /></div>
      <p className="eyebrow">{messages.stepOf(index + 1, steps.length)}</p>
      <h2 id="tutorial-title">{step.title}</h2>
      <p>{step.body}</p>
      {targetRoutes[targetKey(step.target)] ? <Link className="tutorial-open-area" href={targetRoutes[targetKey(step.target)]}><ExternalLink size={15} />{messages.openArea}</Link> : null}
      <footer>
        <button className="text-button" type="button" onClick={() => save("SKIPPED")} disabled={pending}>{messages.skipStep}</button>
        <div>
          <button className="icon-button" type="button" aria-label={messages.previous} disabled={pending || index === 0} onClick={() => setIndex((current) => Math.max(0, current - 1))}><ArrowLeft size={18} /></button>
          <button className="button button-primary" type="button" disabled={pending} onClick={() => save("COMPLETED")}>{index === steps.length - 1 ? <><Check size={17} />{messages.finish}</> : <>{messages.understood}<ArrowRight size={17} /></>}</button>
        </div>
      </footer>
    </aside> : null}
  </>;
}
