"use client";

import { useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LiveUpdatesContext } from "./LiveUpdatesProvider";
import type { LiveContext, LiveTopic } from "@/lib/live-update-contract";
import { protectedLiveRefresh } from "@/lib/protected-live-refresh";
import { liveUpdatesMessages } from "@/lib/live-updates-i18n";
import type { SupportedLocale } from "@/lib/i18n";

export function LiveWorkspaceSync({ topics, context = {}, locale = "en", viewKey = "" }: {
  topics: readonly LiveTopic[]; context?: LiveContext; locale?: SupportedLocale; viewKey?: string;
}) {
  const client = useContext(LiveUpdatesContext);
  const router = useRouter();
  const [deferred, setDeferred] = useState(false);
  const topicKey = [...topics].sort().join(",");
  const { companyId, driverId, branchId } = context;
  useEffect(() => {
    const root = document.getElementById("portal-main");
    if (!root || !client) return;
    const dirty = new Map<Element, string>();
    const baseline = new WeakMap<Element, string>();
    const value = (element: Element) => element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)
      ? String(element.checked) : "value" in element ? String(element.value) : element.textContent ?? "";
    const fields = "input,select,textarea,[contenteditable=true]";
    root.querySelectorAll(fields).forEach((element) => baseline.set(element, value(element)));
    const remember = (event: Event) => {
      const element = event.target;
      if (element instanceof Element && element.matches(fields) && !baseline.has(element)) baseline.set(element, value(element));
    };
    const changed = (event: Event) => {
      const element = event.target;
      if (!(element instanceof Element) || !element.matches(fields)) return;
      if (value(element) === baseline.get(element)) dirty.delete(element);
      else dirty.set(element, value(element));
    };
    const reset = (event: Event) => {
      if (!(event.target instanceof HTMLFormElement)) return;
      event.target.querySelectorAll(fields).forEach((element) => dirty.delete(element));
    };
    const scheduler = protectedLiveRefresh({
      blocked: () => {
        for (const element of dirty.keys()) if (!element.isConnected || value(element) === baseline.get(element)) dirty.delete(element);
        return dirty.size > 0 || document.hidden || !navigator.onLine
          || Boolean(document.querySelector('dialog[open],[role="dialog"][aria-modal="true"]'))
          || Boolean(document.activeElement?.matches(fields));
      },
      // RSC merge preserves current URL/filter/branch, client state and scroll.
      refresh: () => router.refresh(), deferred: setDeferred,
      later: (callback, ms) => setTimeout(callback, ms), clear: (timer) => clearTimeout(timer),
    });
    const unsubscribes = (topicKey.split(",") as LiveTopic[]).map((topic) => client.subscribe(topic, { companyId, driverId, branchId }, () => scheduler.changed()));
    root.addEventListener("focusin", remember, true);
    root.addEventListener("input", changed, true);
    root.addEventListener("change", changed, true);
    root.addEventListener("reset", reset, true);
    return () => {
      scheduler.stop(); unsubscribes.forEach((unsubscribe) => unsubscribe());
      root.removeEventListener("focusin", remember, true);
      root.removeEventListener("input", changed, true);
      root.removeEventListener("change", changed, true);
      root.removeEventListener("reset", reset, true);
    };
  }, [client, router, topicKey, companyId, driverId, branchId, viewKey]);
  return deferred ? <p className="subtle" role="status">{liveUpdatesMessages(locale).liveDeferred}</p> : null;
}
