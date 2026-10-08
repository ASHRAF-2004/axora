"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { SharedLiveClient } from "@/lib/shared-live-client";
import { LiveDetailReader } from "@/lib/live-detail-read";
import type { LiveContext, LiveHint, LiveSnapshot, LiveStatus, LiveTopic } from "@/lib/live-update-contract";
import { liveUpdatesMessages } from "@/lib/live-updates-i18n";
import type { SupportedLocale } from "@/lib/i18n";

export const LiveUpdatesContext = createContext<SharedLiveClient | null>(null);
export function LiveUpdatesProvider({ children, enabled = true }: { children: ReactNode; enabled?: boolean }) {
  const [client] = useState(() => new SharedLiveClient({
    source: typeof EventSource === "function" ? (url) => new EventSource(url, { withCredentials: true }) : undefined,
    read: async (url, signal) => {
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin", signal });
      return { status: response.status, ...(response.ok ? { snapshot: await response.json() as LiveSnapshot } : {}) };
    },
    visible: () => !document.hidden,
    online: () => navigator.onLine,
    later: (callback, ms) => setTimeout(callback, ms),
    clear: (timer) => clearTimeout(timer),
  }));
  useEffect(() => {
    if (!enabled) return;
    const update = () => client.visibilityChanged();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    client.start();
    return () => {
      client.stop();
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [client, enabled]);
  return <LiveUpdatesContext.Provider value={client}>{children}</LiveUpdatesContext.Provider>;
}

export function useLiveTopic(topic: LiveTopic, receive: (hint: LiveHint) => void, context: LiveContext = {}) {
  const client = useContext(LiveUpdatesContext);
  const callback = useRef(receive);
  const { companyId, driverId, branchId } = context;
  useEffect(() => { callback.current = receive; }, [receive]);
  useEffect(() => client?.subscribe(topic, { companyId, driverId, branchId }, (hint) => callback.current(hint)), [client, topic, companyId, driverId, branchId]);
}

/** A hint never carries detail data; refresh through the existing authorized GET. */
export function useLiveRead<T>(topic: LiveTopic, url: string, apply: (value: T) => void, context: LiveContext = {}, failed?: () => void) {
  const current = useRef({ apply, failed });
  const transport = useRef<LiveDetailReader<T> | null>(null);
  useEffect(() => { current.current = { apply, failed }; }, [apply, failed]);
  useEffect(() => {
    const reader = new LiveDetailReader<T>(url, (value) => current.current.apply(value), () => current.current.failed?.());
    transport.current = reader;
    // The existing authorized workspace read must not depend on SSE readiness.
    reader.refresh();
    return () => { reader.stop(); if (transport.current === reader) transport.current = null; };
  }, [url]);
  useLiveTopic(topic, () => transport.current?.refresh(), context);
}

export function LiveUpdatesStatus({ locale }: { locale: SupportedLocale }) {
  const client = useContext(LiveUpdatesContext);
  const [status, setStatus] = useState<LiveStatus>("reconnecting");
  useEffect(() => client?.onStatus(setStatus), [client]);
  const copy = liveUpdatesMessages(locale);
  return <span className="subtle" role="status" aria-live="polite" data-live-status={status}>{
    status === "current" ? copy.liveCurrent : status === "polling" ? copy.livePolling : status === "paused" ? copy.livePaused : copy.liveReconnecting
  }</span>;
}
