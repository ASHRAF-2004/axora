"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { UserAvatar } from "@/components/UserAvatar";
import {
  deliveryTrackingMessages,
  deliveryTrackingStatusLabel,
  customerDeliveryStatusLabel,
  type DeliveryTrackingLocale,
} from "@/lib/delivery-tracking-i18n";
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
  visibilityPrecision: "APPROXIMATE" | "EXACT";
  showVehicleDetails?: boolean;
  contactMode?: "AXORA_RELAY" | "NONE";
  contactPath?: string | null;
  rawRetentionDays: number;
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

function formattedDistance(value: number | null | undefined, locale: DeliveryTrackingLocale) {
  if (value === null || value === undefined) return "—";
  if (value < 1_000) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value)} m`;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value / 1_000)} km`;
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
  locale = "en",
}: {
  actorId: string;
  locale?: DeliveryTrackingLocale;
}) {
  const copy = deliveryTrackingMessages(locale);
  const [workspace, setWorkspace] = useState<TrackingWorkspace | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [endReason, setEndReason] = useState("");
  const [sharingEnabled, setSharingEnabled] = useState(false);
  const failureReported = useRef("");

  const refresh = useCallback(async () => {
    const response = await fetch("/api/driver/tracking", { cache: "no-store" });
    if (!response.ok) throw new Error();
    setWorkspace(await response.json() as TrackingWorkspace);
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

  const active = useMemo(
    () => workspace?.sessions.find((session) => session.status === "ACTIVE"),
    [workspace],
  );
  const activeSessionId = active?.sessionId;
  const workspaceLoaded = workspace !== null;

  useEffect(() => {
    if (!activeSessionId) {
      if (workspaceLoaded) writeQueue(actorId, []);
      return;
    }
    if (!sharingEnabled) return;
    let disposed = false;
    let flushing = false;
    let lastSampleAt = 0;
    let watchId: number | undefined;
    const storedDevice = localStorage.getItem(deviceKey(actorId));
    const deviceId = storedDevice ?? crypto.randomUUID();
    if (!storedDevice) localStorage.setItem(deviceKey(actorId), deviceId);

    const reportFailure = async (failureCode: string, message: string) => {
      if (failureReported.current === `${activeSessionId}:${failureCode}`) return;
      failureReported.current = `${activeSessionId}:${failureCode}`;
      setError(message);
      await postJson("/api/driver/tracking", {
        action: "REPORT_FAILURE",
        sessionId: activeSessionId,
        reason: message,
        failureCode,
      }).catch(() => undefined);
    };

    const flush = async () => {
      if (flushing || !navigator.onLine || disposed) return;
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
          if (response.ok || [401, 403, 404, 409].includes(response.status)) {
            pending = pending.slice(1);
            writeQueue(actorId, pending);
            continue;
          }
          break;
        }
        if (!pending.length) {
          setNotice(copy.activeIndicator);
          void refresh();
        }
      } finally {
        flushing = false;
      }
    };

    const capture = (position: GeolocationPosition) => {
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
    }
    const online = () => { void flush(); };
    window.addEventListener("online", online);
    void flush();
    return () => {
      disposed = true;
      window.removeEventListener("online", online);
      if (watchId !== undefined) navigator.geolocation.clearWatch(watchId);
    };
  }, [
    activeSessionId,
    actorId,
    copy.activeIndicator,
    copy.locationUnavailable,
    copy.offlineBuffered,
    copy.permissionDenied,
    refresh,
    sharingEnabled,
    workspaceLoaded,
  ]);

  const endSharing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!active) return;
    setError("");
    const response = await postJson("/api/driver/tracking", {
      action: "END",
      sessionId: active.sessionId,
      reason: endReason,
    });
    if (!response.ok) {
      setError(copy.commandFailed);
      return;
    }
    writeQueue(actorId, []);
    setEndReason("");
    setNotice(copy.commandSaved);
    await refresh();
  };

  return <section className={styles.driverPanel} aria-label={copy.driverTitle}>
    <header className={styles.panelHeader}>
      <div><span>{copy.status}</span><h2>{copy.driverTitle}</h2></div>
      {active ? <strong className={styles.liveIndicator} role="status">
        <span aria-hidden="true" />{copy.activeIndicator}
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
            <div><strong>{session.jobCode}</strong><small>{session.jobStatus}</small></div>
            <span data-status={session.status}>
              {deliveryTrackingStatusLabel(session.status, locale)}
            </span>
          </div>
          <dl className={styles.compactFacts}>
            <div><dt>{copy.status}</dt><dd>{session.status}</dd></div>
            <div><dt>{copy.points}</dt><dd>{session.pointCount ?? 0}</dd></div>
            <div><dt>{copy.lastUpdated}</dt><dd>{formattedTime(session.lastUpdatedAt, locale)}</dd></div>
            <div><dt>{copy.precision}</dt><dd>{session.visibilityPrecision === "EXACT" ? copy.exact : copy.approximate}</dd></div>
          </dl>
          {session.lastFailureCode ? <p className={styles.warning}>
            {copy.failure}: {session.lastFailureCode}
          </p> : null}
          {session.status === "ACTIVE" ? <form className={styles.endForm} onSubmit={endSharing}>
            <label>{copy.reason}<input value={endReason} onChange={(event) => setEndReason(event.target.value)} minLength={3} maxLength={1000} required /></label>
            <button type="submit">{copy.end}</button>
          </form> : null}
        </article>,
      )}</div>}
    {active && !sharingEnabled ? <button type="button" onClick={() => setSharingEnabled(true)}>{copy.startSharing}</button> : null}
  </section>;
}

function RouteFigure({
  session,
  locale,
}: {
  session: TrackingSession;
  locale: DeliveryTrackingLocale;
}) {
  const copy = deliveryTrackingMessages(locale);
  const hasPoint = session.locationAvailable === true || (
    session.latitude !== null && session.latitude !== undefined
    && session.longitude !== null && session.longitude !== undefined
  );
  const hasDestination = session.destinationLatitude !== null
    && session.destinationLatitude !== undefined
    && session.destinationLongitude !== null
    && session.destinationLongitude !== undefined;
  if (!hasPoint) return <p className={styles.empty}>{copy.awaitingPoint}</p>;
  if (!hasDestination) return <p className={styles.warning}>{copy.destinationUnavailable}</p>;
  const latitudeDelta = Number(session.destinationLatitude) - Number(session.latitude);
  const longitudeDelta = Number(session.destinationLongitude) - Number(session.longitude);
  const longitudeScale = Math.cos(Number(session.latitude) * Math.PI / 180);
  const vectorX = longitudeDelta * longitudeScale;
  const vectorY = -latitudeDelta;
  const magnitude = Math.hypot(vectorX, vectorY);
  const scale = magnitude > 0 ? 390 / magnitude : 0;
  const endX = magnitude > 0 ? 105 + vectorX * scale : 105;
  const endY = magnitude > 0 ? 90 + vectorY * scale : 90;
  const boundedEndX = Math.min(525, Math.max(75, endX));
  const boundedEndY = Math.min(145, Math.max(35, endY));
  const accuracyRadius = Math.min(34, Math.max(12,
    Number(session.accuracyMeters ?? 150) / 10));
  return <figure className={styles.routeFigure} data-stale={session.stale}>
    <svg viewBox="0 0 600 180" role="img" aria-label={copy.routeLabel}>
      <defs>
        <linearGradient id={`route-${session.sessionId}`} x1="0" x2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity=".35" />
          <stop offset="1" stopColor="currentColor" />
        </linearGradient>
      </defs>
      <path d={`M105 90 L${boundedEndX} ${boundedEndY}`} fill="none" stroke={`url(#route-${session.sessionId})`} strokeWidth="10" strokeLinecap="round" />
      <circle className={styles.accuracy} cx="105" cy="90" r={accuracyRadius} />
      <circle className={styles.currentMarker} cx="105" cy="90" r="11" />
      <circle className={styles.destinationMarker} cx={boundedEndX} cy={boundedEndY} r="15" />
    </svg>
    <figcaption>
      <span>{session.visibilityPrecision === "EXACT" ? copy.exact : copy.approximate}</span>
      <strong>{copy.remaining}: {formattedDistance(session.remainingMeters, locale)}</strong>
    </figcaption>
  </figure>;
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
            <span data-status={session.status}>{deliveryTrackingStatusLabel(session.status, locale)}</span>
          </div>
          {session.agentUserId && session.agentName ? <div className={styles.agent}>
            <UserAvatar deliveryJobId={session.jobId} name={session.agentName} size={48} userId={session.agentUserId} />
            <div><small>{copy.agent}</small><strong>{session.agentName}</strong></div>
          </div> : null}
          <RouteFigure session={session} locale={locale} />
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
