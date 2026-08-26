"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { UserAvatar } from "@/components/UserAvatar";
import { DeliveryDestinationMap } from "./DeliveryDestinationMap";
import {
  deliveryTrackingMessages,
  deliveryTrackingStatusLabel,
  customerDeliveryStatusLabel,
  type DeliveryTrackingLocale,
} from "@/lib/delivery-tracking-i18n";
import { deliveryWorkflowStatusLabel } from "@/lib/delivery-workflow-i18n";
import styles from "./DeliveryTracking.module.css";

type TrackingSession = {
  sessionId: string;
  jobId: string;
  jobCode: string;
  branchName?: string;
  companyName?: string;
  jobStatus: string;
  status: string;
  startedAt?: string | null;
  pausedAt?: string | null;
  lastUpdatedAt?: string | null;
  stale?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  locationAvailable?: boolean;
  accuracyMeters?: number | null;
  destinationLatitude?: number | null;
  destinationLongitude?: number | null;
  remainingMeters?: number | null;
  etaSeconds?: number | null;
  routeMode?: "DIRECT_ESTIMATE" | "PRIVACY_SAFE_DIRECT_ESTIMATE" | string;
  visibilityPrecision: "APPROXIMATE" | "EXACT";
  showVehicleDetails?: boolean;
  contactMode?: "AXORA_RELAY" | "NONE";
  contactPath?: string | null;
  rawRetentionDays?: number;
  vehicleType?: string | null;
  vehicleColour?: string | null;
  vehicleRegistration?: string | null;
  agentUserId?: string;
  agentName?: string;
  pointCount?: number;
  lastFailureCode?: string | null;
  lastFailureAt?: string | null;
};

type TrackingWorkspace = {
  actorId?: string;
  capturedAt: string;
  sessions: TrackingSession[];
};

export type DriverDeliveryReference = {
  id: string;
  address: string;
  destinationLatitude?: number;
  destinationLongitude?: number;
};

type QueuedPoint = {
  action: "POINT";
  sessionId: string;
  pointId: string;
  deviceId: string;
  deviceSequence: number;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  speedMps: number | null;
  headingDegrees: number | null;
  recordedAt: string;
};

const MAX_BUFFERED_POINTS = 100;
const MAX_BUFFER_BYTES = 256 * 1024;
const REFRESH_INTERVAL_MS = 15_000;

function queueKey(actorId: string) {
  return `axora:delivery-location:v1:${actorId}`;
}

function deviceKey(actorId: string) {
  return `axora:delivery-location-device:v1:${actorId}`;
}

function pausedSharingKey(actorId: string) {
  return `axora:delivery-location-paused:v1:${actorId}`;
}

function readQueue(actorId: string): QueuedPoint[] {
  const raw = localStorage.getItem(queueKey(actorId));
  if (!raw) return [];
  if (raw.length > MAX_BUFFER_BYTES) {
    localStorage.removeItem(queueKey(actorId));
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed) || parsed.length > MAX_BUFFERED_POINTS) throw new Error();
    return parsed.filter((item): item is QueuedPoint => Boolean(
      item && typeof item === "object"
      && (item as QueuedPoint).action === "POINT"
      && typeof (item as QueuedPoint).sessionId === "string"
      && typeof (item as QueuedPoint).pointId === "string"
      && typeof (item as QueuedPoint).latitude === "number"
      && typeof (item as QueuedPoint).longitude === "number",
    ));
  } catch {
    localStorage.removeItem(queueKey(actorId));
    return [];
  }
}

function writeQueue(actorId: string, points: QueuedPoint[]) {
  if (!points.length) {
    localStorage.removeItem(queueKey(actorId));
    return;
  }
  const bounded = points.slice(-MAX_BUFFERED_POINTS);
  const serialized = JSON.stringify(bounded);
  if (serialized.length <= MAX_BUFFER_BYTES) {
    localStorage.setItem(queueKey(actorId), serialized);
  }
}

function formattedTime(value: string | null | undefined, locale: DeliveryTrackingLocale) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formattedEta(value: number | null | undefined, locale: DeliveryTrackingLocale) {
  if (value === null || value === undefined) return null;
  const minutes = Math.max(1, Math.ceil(value / 60));
  return new Intl.RelativeTimeFormat(locale, { numeric: "always" }).format(minutes, "minute");
}

async function postJson(endpoint: string, body: Record<string, unknown>) {
  return fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function DriverTrackingPanel({
  actorId,
  deliveries = [],
  locale = "en",
}: {
  actorId: string;
  deliveries?: DriverDeliveryReference[];
  locale?: DeliveryTrackingLocale;
}) {
  const copy = deliveryTrackingMessages(locale);
  const [workspace, setWorkspace] = useState<TrackingWorkspace | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [sharingEnabled, setSharingEnabled] = useState(false);
  const [resumeRequired, setResumeRequired] = useState(false);
  const [controlBusy, setControlBusy] = useState(false);
  const workspaceRef = useRef<TrackingWorkspace | null>(null);
  const failureReported = useRef("");
  const terminalJobIds = useRef(new Set<string>());
  const browserWatchId = useRef<number | null>(null);
  const collectionEpoch = useRef(0);
  const controlEpoch = useRef(0);
  const deliveriesById = useMemo(() => new Map(
    deliveries.map((delivery) => [delivery.id, delivery]),
  ), [deliveries]);

  const rememberResumeRequired = useCallback((sessionId: string) => {
    localStorage.setItem(pausedSharingKey(actorId), sessionId);
    setResumeRequired(true);
  }, [actorId]);

  const clearResumeRequired = useCallback(() => {
    localStorage.removeItem(pausedSharingKey(actorId));
    setResumeRequired(false);
  }, [actorId]);

  const stopBrowserCollection = useCallback(() => {
    collectionEpoch.current += 1;
    const watchId = browserWatchId.current;
    browserWatchId.current = null;
    if (watchId !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(watchId);
    }
  }, []);

  const invalidatePendingControl = useCallback(() => {
    controlEpoch.current += 1;
    setControlBusy(false);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setResumeRequired(Boolean(localStorage.getItem(pausedSharingKey(actorId))));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [actorId]);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/driver/tracking", { cache: "no-store" });
    if (!response.ok) throw new Error();
    const next = await response.json() as TrackingWorkspace;
    const authoritative = {
      ...next,
      sessions: next.sessions.filter((session) => (
        !terminalJobIds.current.has(session.jobId)
      )),
    };
    workspaceRef.current = authoritative;
    setWorkspace(authoritative);
    return authoritative;
  }, []);

  useEffect(() => {
    const start = window.setTimeout(() => {
      void refresh().catch(() => setError(copy.unavailable));
    }, 0);
    const interval = window.setInterval(() => {
      void refresh().catch(() => setError(copy.unavailable));
    }, REFRESH_INTERVAL_MS);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
    };
  }, [copy.unavailable, refresh]);

  useEffect(() => {
    const progressed = () => {
      void refresh().catch(() => setError(copy.unavailable));
    };
    window.addEventListener("axora:delivery-claimed", progressed);
    window.addEventListener("axora:delivery-progressed", progressed);
    return () => {
      window.removeEventListener("axora:delivery-claimed", progressed);
      window.removeEventListener("axora:delivery-progressed", progressed);
    };
  }, [copy.unavailable, refresh]);

  useEffect(() => {
    const completionPending = (event: Event) => {
      const detail = (event as CustomEvent<{ jobId?: string }>).detail;
      if (!detail?.jobId) return;
      const session = workspaceRef.current?.sessions.find((item) => (
        item.jobId === detail.jobId && ["ACTIVE", "PAUSED"].includes(item.status)
      ));
      // Completing a handover is a privacy boundary. Stop the browser watch
      // before awaiting the command response; if completion is rejected or
      // remains unresolved, the still-visible session offers an explicit
      // Resume action and RESUME is idempotent against an ACTIVE session.
      invalidatePendingControl();
      stopBrowserCollection();
      setSharingEnabled(false);
      writeQueue(actorId, []);
      if (session) rememberResumeRequired(session.sessionId);
      setNotice(copy.commandChecking);
    };
    window.addEventListener("axora:delivery-completion-pending", completionPending);
    return () => window.removeEventListener(
      "axora:delivery-completion-pending",
      completionPending,
    );
  }, [
    actorId,
    copy.commandChecking,
    invalidatePendingControl,
    rememberResumeRequired,
    stopBrowserCollection,
  ]);

  useEffect(() => {
    const terminal = (event: Event) => {
      const detail = (event as CustomEvent<{ jobId?: string }>).detail;
      if (!detail?.jobId) return;
      terminalJobIds.current.add(detail.jobId);
      invalidatePendingControl();
      stopBrowserCollection();
      setSharingEnabled(false);
      writeQueue(actorId, []);
      clearResumeRequired();
      setWorkspace((snapshot) => snapshot ? {
        ...snapshot,
        sessions: snapshot.sessions.filter((session) => (
          session.jobId !== detail.jobId
        )),
      } : snapshot);
      setNotice(copy.endedIndicator);
    };
    window.addEventListener("axora:delivery-terminal", terminal);
    return () => window.removeEventListener("axora:delivery-terminal", terminal);
  }, [
    actorId,
    clearResumeRequired,
    copy.endedIndicator,
    invalidatePendingControl,
    stopBrowserCollection,
  ]);

  const current = useMemo(
    () => workspace?.sessions.find((session) => ["ACTIVE", "PAUSED"].includes(session.status)),
    [workspace],
  );
  const activeSessionId = current?.status === "ACTIVE" ? current.sessionId : undefined;
  const hasControllableSession = Boolean(current);
  const workspaceLoaded = workspace !== null;

  useEffect(() => {
    if (!hasControllableSession) {
      if (workspaceLoaded) {
        writeQueue(actorId, []);
        localStorage.removeItem(pausedSharingKey(actorId));
        const timer = window.setTimeout(() => setResumeRequired(false), 0);
        return () => window.clearTimeout(timer);
      }
      return;
    }
    if (!activeSessionId || !sharingEnabled) return;
    let disposed = false;
    let flushing = false;
    let lastSampleAt = 0;
    let watchId: number | undefined;
    const epoch = collectionEpoch.current + 1;
    collectionEpoch.current = epoch;
    const storedDevice = localStorage.getItem(deviceKey(actorId));
    const deviceId = storedDevice ?? crypto.randomUUID();
    if (!storedDevice) localStorage.setItem(deviceKey(actorId), deviceId);

    const reportFailure = async (failureCode: string, message: string) => {
      if (failureReported.current === `${activeSessionId}:${failureCode}`) return;
      failureReported.current = `${activeSessionId}:${failureCode}`;
      setError(message);
      stopBrowserCollection();
      setSharingEnabled(false);
      rememberResumeRequired(activeSessionId);
      await postJson("/api/driver/tracking", {
        action: "REPORT_FAILURE",
        sessionId: activeSessionId,
        reason: failureCode,
        failureCode,
      }).catch(() => undefined);
      const paused = await postJson("/api/driver/tracking", {
        action: "PAUSE",
        sessionId: activeSessionId,
        reason: "Location sharing paused after browser location failure",
      }).catch(() => null);
      if (paused?.ok) {
        setWorkspace((snapshot) => snapshot ? {
          ...snapshot,
          sessions: snapshot.sessions.map((session) => session.sessionId === activeSessionId
            ? { ...session, status: "PAUSED", pausedAt: new Date().toISOString() }
            : session),
        } : snapshot);
      } else if (!paused || paused.status >= 500) {
        void refresh().catch(() => undefined);
      }
    };

    const flush = async () => {
      if (flushing || !navigator.onLine || disposed
        || collectionEpoch.current !== epoch) return;
      flushing = true;
      let pending = readQueue(actorId).filter(
        (point) => point.sessionId === activeSessionId,
      );
      try {
        while (pending.length && !disposed) {
          let response: Response;
          try {
            response = await postJson("/api/driver/tracking", pending[0]);
          } catch {
            setNotice(copy.offlineBuffered);
            break;
          }
          if (disposed || collectionEpoch.current !== epoch) break;
          if (response.ok || [401, 403, 404, 409].includes(response.status)) {
            pending = pending.slice(1);
            writeQueue(actorId, pending);
            continue;
          }
          break;
        }
        if (!pending.length) {
          setNotice(copy.activeIndicator);
          void refresh().catch(() => setError(copy.unavailable));
        }
      } finally {
        flushing = false;
      }
    };

    const capture = (position: GeolocationPosition) => {
      if (disposed || collectionEpoch.current !== epoch) return;
      const now = Date.now();
      const stationary = position.coords.speed !== null && position.coords.speed < 1;
      const minimumDelay = stationary ? 60_000 : 15_000;
      if (now-lastSampleAt < minimumDelay) return;
      lastSampleAt = now;
      if (position.coords.accuracy <= 0 || position.coords.accuracy > 2_000) {
        void reportFailure("LOCATION_UNAVAILABLE", copy.locationUnavailable);
        return;
      }
      const point: QueuedPoint = {
        action: "POINT",
        sessionId: activeSessionId,
        pointId: crypto.randomUUID(),
        deviceId,
        deviceSequence: now,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        speedMps: position.coords.speed,
        headingDegrees: position.coords.heading,
        recordedAt: new Date(position.timestamp).toISOString(),
      };
      writeQueue(actorId, [...readQueue(actorId), point]);
      if (navigator.onLine) void flush();
      else setNotice(copy.offlineBuffered);
    };

    const captureError = (failure: GeolocationPositionError) => {
      const permissionDenied = failure.code === 1;
      void reportFailure(
        permissionDenied ? "PERMISSION_DENIED"
          : failure.code === 3 ? "LOCATION_TIMEOUT" : "LOCATION_UNAVAILABLE",
        permissionDenied ? copy.permissionDenied : copy.locationUnavailable,
      );
    };

    if (!("geolocation" in navigator)) {
      void reportFailure("LOCATION_UNAVAILABLE", copy.locationUnavailable);
    } else {
      watchId = navigator.geolocation.watchPosition(capture, captureError, {
        enableHighAccuracy: true,
        maximumAge: 10_000,
        timeout: 20_000,
      });
      browserWatchId.current = watchId;
    }
    const online = () => { void flush(); };
    window.addEventListener("online", online);
    void flush();
    return () => {
      disposed = true;
      window.removeEventListener("online", online);
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
      if (browserWatchId.current === watchId) browserWatchId.current = null;
      if (collectionEpoch.current === epoch) collectionEpoch.current += 1;
    };
  }, [
    activeSessionId,
    actorId,
    copy.activeIndicator,
    copy.locationUnavailable,
    copy.offlineBuffered,
    copy.permissionDenied,
    copy.unavailable,
    refresh,
    sharingEnabled,
    workspaceLoaded,
    hasControllableSession,
    rememberResumeRequired,
    stopBrowserCollection,
  ]);

  const startOrResumeSharing = async () => {
    if (!current || controlBusy) return;
    const operationEpoch = controlEpoch.current + 1;
    controlEpoch.current = operationEpoch;
    setControlBusy(true);
    setError("");
    const mustResume = current.status === "PAUSED" || resumeRequired
      || localStorage.getItem(pausedSharingKey(actorId)) === current.sessionId;
    let resumed = !mustResume;
    if (mustResume) {
      // RESUME targets ACTIVE and is idempotent. It safely resolves a PAUSE
      // whose HTTP response was lost, while an initial Start can still capture
      // into the bounded offline queue without network access.
      const response = await postJson("/api/driver/tracking", {
        action: "RESUME",
        sessionId: current.sessionId,
        reason: "Delivery Agent started or resumed browser location sharing",
      }).catch(() => null);
      resumed = response?.ok === true;
      if (!resumed) {
        setNotice(copy.commandChecking);
        try {
          const authoritative = await refresh();
          resumed = authoritative.sessions.some((session) => (
            session.sessionId === current.sessionId && session.status === "ACTIVE"
          ));
        } catch { /* Keep browser sharing disabled while unresolved. */ }
      }
    }
    if (controlEpoch.current !== operationEpoch) return;
    if (!resumed) {
      setNotice(copy.commandUnconfirmed);
      setError(copy.commandFailed);
      setControlBusy(false);
      return;
    }
    setWorkspace((snapshot) => snapshot ? {
      ...snapshot,
      sessions: snapshot.sessions.map((session) => session.sessionId === current.sessionId
        ? { ...session, status: "ACTIVE" }
        : session),
    } : snapshot);
    clearResumeRequired();
    failureReported.current = "";
    setSharingEnabled(true);
    setNotice(copy.activeIndicator);
    setControlBusy(false);
    void refresh().catch(() => setNotice(copy.commandSaved));
  };

  const pauseSharing = async () => {
    if (!current || current.status !== "ACTIVE" || controlBusy) return;
    const operationEpoch = controlEpoch.current + 1;
    controlEpoch.current = operationEpoch;
    setControlBusy(true);
    setError("");
    // Stop the browser watch immediately on the user's privacy action. The
    // server command is then reconciled independently.
    stopBrowserCollection();
    setSharingEnabled(false);
    rememberResumeRequired(current.sessionId);
    const response = await postJson("/api/driver/tracking", {
      action: "PAUSE",
      sessionId: current.sessionId,
      reason: "Delivery Agent paused browser location sharing",
    }).catch(() => null);
    let paused = response?.ok === true;
    if (!paused) {
      setNotice(copy.commandChecking);
      try {
        const authoritative = await refresh();
        paused = authoritative.sessions.some((session) => (
          session.sessionId === current.sessionId && session.status === "PAUSED"
        ));
      } catch { /* Browser collection is already stopped. */ }
    }
    if (controlEpoch.current !== operationEpoch) return;
    if (!paused) {
      setNotice(copy.commandUnconfirmed);
      setError(copy.commandFailed);
      setControlBusy(false);
      return;
    }
    setWorkspace((snapshot) => snapshot ? {
      ...snapshot,
      sessions: snapshot.sessions.map((session) => session.sessionId === current.sessionId
        ? { ...session, status: "PAUSED", pausedAt: new Date().toISOString() }
        : session),
    } : snapshot);
    setNotice(copy.pausedIndicator);
    setControlBusy(false);
    void refresh().catch(() => setNotice(copy.commandSaved));
  };

  return <section className={styles.driverPanel} aria-label={copy.driverTitle}>
    <header className={styles.panelHeader}>
      <div><span>{copy.status}</span><h2>{copy.driverTitle}</h2></div>
      {current ? <strong className={sharingEnabled ? styles.liveIndicator : styles.readyIndicator} role="status">
        <span aria-hidden="true" />{sharingEnabled ? copy.activeIndicator
          : current.status === "PAUSED" || resumeRequired
            ? copy.pausedIndicator : copy.readyIndicator}
      </strong> : null}
    </header>
    <p className={styles.explanation}>{copy.driverExplanation}</p>
    {notice ? <p className={styles.notice} role="status">{notice}</p> : null}
    {error ? <p className={styles.warning} role="alert">{error}</p> : null}
    {!workspace ? <p>{copy.loading}</p> : workspace.sessions.length === 0
      ? <p className={styles.empty}>{copy.noSessions}</p>
      : <div className={styles.sessionList}>{workspace.sessions.map((session) =>
        <article className={styles.sessionCard} key={session.sessionId}>
          <div className={styles.sessionHeading}>
            <div><strong>{session.jobCode}</strong><small>{deliveryWorkflowStatusLabel(session.jobStatus, locale)}</small></div>
            <span data-status={session.status}>
              {session.status === "ACTIVE" && session.sessionId === current?.sessionId
                && !sharingEnabled ? resumeRequired ? copy.pausedIndicator : copy.readyIndicator
                : deliveryTrackingStatusLabel(session.status, locale)}
            </span>
          </div>
          <dl className={styles.compactFacts}>
            <div><dt>{copy.status}</dt><dd>{deliveryTrackingStatusLabel(session.status, locale)}</dd></div>
            <div><dt>{copy.points}</dt><dd>{session.pointCount ?? 0}</dd></div>
            <div><dt>{copy.lastUpdated}</dt><dd>{formattedTime(session.lastUpdatedAt, locale)}</dd></div>
            <div><dt>{copy.precision}</dt><dd>{session.visibilityPrecision === "EXACT" ? copy.exact : copy.approximate}</dd></div>
          </dl>
          {typeof session.destinationLatitude === "number"
            && typeof session.destinationLongitude === "number" ? <DeliveryDestinationMap
              address={deliveriesById.get(session.jobId)?.address ?? session.branchName ?? copy.destinationUnavailable}
              currentLatitude={session.latitude}
              currentLongitude={session.longitude}
              etaSeconds={session.stale ? null : session.etaSeconds}
              latitude={session.destinationLatitude}
              locale={locale}
              longitude={session.destinationLongitude}
              remainingMeters={session.remainingMeters}
              trackingStatus={sharingEnabled && session.sessionId === current?.sessionId
                ? copy.activeIndicator : deliveryTrackingStatusLabel(session.status, locale)}
            /> : null}
          {session.lastFailureCode ? <p className={styles.warning}>
            {copy.failure}: {session.lastFailureCode}
          </p> : null}
          {session.sessionId === current?.sessionId ? <div className={styles.sharingControls}>
            {sharingEnabled && session.status === "ACTIVE"
              ? <button type="button" disabled={controlBusy} onClick={() => void pauseSharing()}>{copy.pauseSharing}</button>
              : <button type="button" disabled={controlBusy} onClick={() => void startOrResumeSharing()}>
                {session.status === "PAUSED" || resumeRequired || (session.pointCount ?? 0) > 0
                  ? copy.resumeSharing : copy.startSharing}
              </button>}
          </div> : null}
        </article>,
      )}</div>}
  </section>;
}

export function DeliveryTrackingBoard({
  locale = "en",
}: {
  locale?: DeliveryTrackingLocale;
}) {
  const copy = deliveryTrackingMessages(locale);
  const endpoint = "/api/receiving/delivery-tracking";
  const [workspace, setWorkspace] = useState<TrackingWorkspace | null>(null);
  const [error, setError] = useState("");
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error();
    setWorkspace(await response.json() as TrackingWorkspace);
  }, [endpoint]);

  useEffect(() => {
    let source: EventSource | null = null;
    let fallback: number | undefined;
    let disposed = false;
    const connect = async () => {
      if (disposed || document.hidden) return;
      await refresh().catch(() => setError(copy.unavailable));
      if (typeof globalThis.EventSource !== "function") {
        fallback = window.setInterval(() => void refresh().catch(() => setError(copy.unavailable)), REFRESH_INTERVAL_MS);
        return;
      }
      source = new EventSource("/api/receiving/delivery-tracking/live");
      source.addEventListener("snapshot", (event) => {
        const message = JSON.parse((event as MessageEvent<string>).data) as {
          sequence: number;
          snapshot: TrackingWorkspace;
        };
        if (message.sequence <= sequence.current) return;
        sequence.current = message.sequence;
        setWorkspace(message.snapshot);
        setError("");
      });
      source.onerror = () => {
        source?.close();
        source = null;
        if (!fallback) fallback = window.setInterval(() => void refresh().catch(() => setError(copy.unavailable)), REFRESH_INTERVAL_MS);
      };
    };
    const visibility = () => {
      source?.close();
      source = null;
      if (fallback) window.clearInterval(fallback);
      fallback = undefined;
      if (!document.hidden) void connect();
    };
    document.addEventListener("visibilitychange", visibility);
    void connect();
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visibility);
      source?.close();
      if (fallback) window.clearInterval(fallback);
    };
  }, [copy.unavailable, refresh]);

  return <section className={styles.board} aria-label={copy.companyTitle}>
    <header className={styles.panelHeader}>
      <div><span>{copy.status}</span><h2>{copy.companyTitle}</h2></div>
      <button type="button" onClick={() => void refresh()}>{copy.lastUpdated}</button>
    </header>
    {error ? <p className={styles.warning} role="alert">{error}</p> : null}
    {!workspace ? <p>{copy.loading}</p> : workspace.sessions.length === 0
      ? <p className={styles.empty}>{copy.noActiveDeliveries}</p>
      : <div className={styles.sessionList}>{workspace.sessions.map((session) =>
        <article className={styles.trackingCard} key={session.sessionId}>
          <div className={styles.sessionHeading}>
            <div>
              <small>{session.companyName ? `${session.companyName} · ` : ""}{session.branchName}</small>
              <h3>{session.jobCode}</h3>
            </div>
            <span data-status={session.status}>{session.status === "ACTIVE" && !session.locationAvailable
              ? copy.readyIndicator : deliveryTrackingStatusLabel(session.status, locale)}</span>
          </div>
          {session.agentUserId && session.agentName ? <div className={styles.agent}>
            <UserAvatar deliveryJobId={session.jobId} name={session.agentName} size={48} userId={session.agentUserId} />
            <div><small>{copy.agent}</small><strong>{session.agentName}</strong></div>
          </div> : null}
          {typeof session.destinationLatitude === "number"
            && typeof session.destinationLongitude === "number" ? <DeliveryDestinationMap
              address={session.branchName ?? copy.destinationUnavailable}
              currentLatitude={session.latitude}
              currentLongitude={session.longitude}
              etaSeconds={session.stale ? null : session.etaSeconds}
              latitude={session.destinationLatitude}
              locale={locale}
              longitude={session.destinationLongitude}
              remainingMeters={session.remainingMeters}
              showNavigationLinks={false}
              trackingStatus={session.status === "ACTIVE" && !session.locationAvailable
                ? copy.readyIndicator : deliveryTrackingStatusLabel(session.status, locale)}
            /> : session.status === "ENDED" ? null
              : session.locationAvailable ? <p className={styles.warning}>{copy.destinationUnavailable}</p>
                : <p className={styles.empty}>{copy.awaitingPoint}</p>}
          <dl className={styles.compactFacts}>
            <div><dt>{copy.lastUpdated}</dt><dd>{formattedTime(session.lastUpdatedAt, locale)}</dd></div>
            <div><dt>{copy.eta}</dt><dd>{session.stale ? copy.etaUnavailable : formattedEta(session.etaSeconds, locale) ?? copy.etaUnavailable}</dd></div>
            <div><dt>{copy.precision}</dt><dd>{session.visibilityPrecision === "EXACT" ? copy.exact : copy.approximate}</dd></div>
            <div><dt>{copy.status}</dt><dd>{customerDeliveryStatusLabel(session.jobStatus, locale)}</dd></div>
          </dl>
          {session.stale ? <p className={styles.warning} role="status">{copy.stale} · {copy.lastUpdated}: {formattedTime(session.lastUpdatedAt, locale)}</p> : null}
          {session.lastFailureCode ? <p className={styles.warning}>{copy.failure}: {session.lastFailureCode}</p> : null}
          {session.vehicleType || session.vehicleColour || session.vehicleRegistration
            ? <p className={styles.vehicle}><strong>{copy.vehicle}</strong> {[session.vehicleType, session.vehicleColour, session.vehicleRegistration].filter(Boolean).join(" · ")}</p>
            : null}
          {session.contactMode === "AXORA_RELAY" && session.contactPath
            ? <a className={styles.contactLink} href={session.contactPath}>{copy.relay}</a>
            : null}
        </article>,
      )}</div>}
  </section>;
}
