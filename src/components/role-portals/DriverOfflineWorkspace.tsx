"use client";

import {
  acknowledgeSyncedDriverEvent,
  createDriverOfflineEvent,
  driverDeviceStorageKey,
  driverQueueStorageKey,
  driverSequenceStorageKey,
  enqueueDriverOfflineEvent,
  isUuid,
  parseDriverOfflineQueue,
  serializeDriverOfflineQueue,
  type DriverOfflineEvent,
  type DriverOfflineQueueInspection,
} from "@/lib/driver-offline-queue";
import {
  buildDeliveryNavigationUrl,
  canRecordDriverEvent,
  DELIVERY_ISSUE_CODES,
  isStateChangingDriverEvent,
  validateDeliveryEventDetails,
  type DeliveryClientEventType,
  type DeliveryEventDetails,
  type DeliveryIssueCode,
  type DeliveryProgressStatus,
} from "@/lib/delivery-portal";
import type { SupportedLocale } from "@/lib/i18n";
import type { DriverJobWorkspaceItem } from "@/lib/role-portals-repository";
import {
  formatRolePortalDateTime,
  formatRolePortalStatus,
  rolePortalMessages,
} from "@/lib/role-portals-i18n";
import { CloudOff, Download, MapPin, Navigation, PackageCheck, RefreshCw, Route, ShieldAlert, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./RolePortals.module.css";

interface EvidenceRetry {
  signature: string;
  clientEvidenceId: string;
  capturedAt: string;
}

export function DriverOfflineWorkspace({
  actorId,
  jobs,
  locale = "en",
  timeZone = "Asia/Kuala_Lumpur",
}: {
  actorId: string;
  jobs: DriverJobWorkspaceItem[];
  locale?: SupportedLocale;
  timeZone?: string;
}) {
  const copy = rolePortalMessages(locale).driver;
  const [queue, setQueue] = useState<DriverOfflineEvent[]>([]);
  const [online, setOnline] = useState<boolean | null>(null);
  const [syncState, setSyncState] = useState<"idle" | "syncing" | "error">("idle");
  const [syncMessage, setSyncMessage] = useState("");
  const [queueRecovery, setQueueRecovery] = useState<Extract<DriverOfflineQueueInspection, { status: "recovery-required" }> | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [localStatus, setLocalStatus] = useState<Record<string, DeliveryClientEventType>>({});
  const [eventIds, setEventIds] = useState<Record<string, string>>(() => Object.fromEntries(jobs.flatMap((job) => job.lastEventId ? [[job.id, job.lastEventId]] : [])));
  const [evidenceState, setEvidenceState] = useState<Record<string, string>>({});
  const queueRef = useRef<DriverOfflineEvent[]>([]);
  const deviceIdRef = useRef("");
  const syncingRef = useRef(false);
  const queueReadyRef = useRef(false);
  const validatedStorageRef = useRef<string | null | undefined>(undefined);
  const evidenceRetryRef = useRef<Record<string, EvidenceRetry>>({});

  const updateQueue = useCallback((next: DriverOfflineEvent[]) => {
    if (!queueReadyRef.current) throw new Error("The saved delivery queue requires recovery.");
    const currentRaw = localStorage.getItem(driverQueueStorageKey(actorId));
    if (currentRaw !== validatedStorageRef.current) {
      throw new Error("Saved delivery storage changed after validation.");
    }
    const serialized = serializeDriverOfflineQueue(actorId, next);
    localStorage.setItem(driverQueueStorageKey(actorId), serialized);
    validatedStorageRef.current = serialized;
    queueRef.current = next;
    setQueue(next);
  }, [actorId]);

  const applyQueueInspection = useCallback((inspection: DriverOfflineQueueInspection, raw: string | null) => {
    validatedStorageRef.current = raw;
    if (inspection.status === "recovery-required") {
      queueReadyRef.current = false;
      queueRef.current = [];
      setQueue([]);
      setQueueRecovery(inspection);
      setConfirmDiscard(false);
      setSyncState("error");
      setSyncMessage(copy.queueRecoveryRequired);
      return false;
    }
    queueReadyRef.current = true;
    queueRef.current = inspection.events;
    setQueue(inspection.events);
    setQueueRecovery(null);
    setConfirmDiscard(false);
    setLocalStatus(Object.fromEntries(inspection.events
      .filter((event) => isStateChangingDriverEvent(event.eventType))
      .map((event) => [event.deliveryJobId, event.eventType])));
    return true;
  }, [copy.queueRecoveryRequired]);

  const syncPending = useCallback(async () => {
    if (!queueReadyRef.current || syncingRef.current || typeof navigator === "undefined" || !navigator.onLine) return;
    syncingRef.current = true;
    setSyncState("syncing");
    setSyncMessage("");
    try {
      while (queueRef.current.length) {
        const event = queueRef.current[0];
        const response = await fetch("/api/driver/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(event),
        });
        const payload = await response.json().catch(() => ({})) as { eventId?: string; error?: string };
        if (!response.ok || !isUuid(payload.eventId)) throw new Error(copy.serverNotConfirmed);
        if (isStateChangingDriverEvent(event.eventType)) {
          setEventIds((current) => ({ ...current, [event.deliveryJobId]: payload.eventId as string }));
        }
        updateQueue(acknowledgeSyncedDriverEvent(queueRef.current, event.clientEventId));
      }
      setSyncState("idle");
      setSyncMessage(copy.allSynced);
    } catch {
      setSyncState("error");
      setSyncMessage(copy.syncPaused);
    } finally {
      syncingRef.current = false;
    }
  }, [copy, updateQueue]);

  useEffect(() => {
    let storageAvailable = true;
    try {
      const queueKey = driverQueueStorageKey(actorId);
      const raw = localStorage.getItem(queueKey);
      const stored = parseDriverOfflineQueue(
        raw,
        actorId,
      );
      applyQueueInspection(stored, raw);
      const storedDeviceId = localStorage.getItem(driverDeviceStorageKey(actorId));
      deviceIdRef.current = isUuid(storedDeviceId) ? storedDeviceId : crypto.randomUUID();
      localStorage.setItem(driverDeviceStorageKey(actorId), deviceIdRef.current);
    } catch {
      storageAvailable = false;
      queueReadyRef.current = false;
      setSyncState("error");
      setSyncMessage(copy.offlineStorageUnavailable);
    }
    const setConnectivity = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine && storageAvailable) void syncPending();
    };
    setConnectivity();
    window.addEventListener("online", setConnectivity);
    window.addEventListener("offline", setConnectivity);
    const handleStorageChange = (event: StorageEvent) => {
      if (event.storageArea !== localStorage || event.key !== driverQueueStorageKey(actorId)) return;
      try {
        const inspection = parseDriverOfflineQueue(event.newValue, actorId);
        if (applyQueueInspection(inspection, event.newValue)) {
          setSyncState("idle");
          setSyncMessage(copy.queueReloaded);
          if (navigator.onLine) void syncPending();
        }
      } catch {
        queueReadyRef.current = false;
        setSyncState("error");
        setSyncMessage(copy.offlineStorageUnavailable);
      }
    };
    window.addEventListener("storage", handleStorageChange);
    const interval = window.setInterval(() => {
      if (storageAvailable) void syncPending();
    }, 30_000);
    return () => {
      window.removeEventListener("online", setConnectivity);
      window.removeEventListener("offline", setConnectivity);
      window.removeEventListener("storage", handleStorageChange);
      window.clearInterval(interval);
    };
  }, [actorId, applyQueueInspection, copy, syncPending]);

  function retryQueueRecovery() {
    try {
      const raw = localStorage.getItem(driverQueueStorageKey(actorId));
      const inspection = parseDriverOfflineQueue(
        raw,
        actorId,
      );
      if (applyQueueInspection(inspection, raw)) {
        setSyncState("idle");
        setSyncMessage(copy.queueRecoveryResolved);
        if (navigator.onLine) void syncPending();
      }
    } catch {
      queueReadyRef.current = false;
      setSyncState("error");
      setSyncMessage(copy.offlineStorageUnavailable);
    }
  }

  function exportQueueRecovery() {
    if (!queueRecovery) return;
    const blob = new Blob([queueRecovery.raw], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `axora-delivery-queue-recovery-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setSyncMessage(copy.queueRecoveryExported);
  }

  function discardQueueRecovery() {
    try {
      localStorage.removeItem(driverQueueStorageKey(actorId));
      if (localStorage.getItem(driverQueueStorageKey(actorId)) !== null) {
        throw new Error("Saved delivery storage could not be cleared.");
      }
      queueReadyRef.current = true;
      validatedStorageRef.current = null;
      queueRef.current = [];
      setQueue([]);
      setLocalStatus({});
      setQueueRecovery(null);
      setConfirmDiscard(false);
      setSyncState("idle");
      setSyncMessage(copy.queueRecoveryDiscarded);
    } catch {
      queueReadyRef.current = false;
      setSyncState("error");
      setSyncMessage(copy.offlineStorageUnavailable);
    }
  }

  function nextSequence() {
    const key = driverSequenceStorageKey(actorId);
    const current = Number(localStorage.getItem(key) ?? 0);
    const entropy = crypto.getRandomValues(new Uint16Array(1))[0] % 1_024;
    const timeSequence = Date.now() * 1_024 + entropy;
    const next = Number.isSafeInteger(current) && current >= timeSequence ? current + 1 : timeSequence;
    localStorage.setItem(key, String(next));
    return next;
  }

  function currentDeviceId() {
    if (isUuid(deviceIdRef.current)) return deviceIdRef.current;
    const stored = localStorage.getItem(driverDeviceStorageKey(actorId));
    deviceIdRef.current = isUuid(stored) ? stored : crypto.randomUUID();
    localStorage.setItem(driverDeviceStorageKey(actorId), deviceIdRef.current);
    return deviceIdRef.current;
  }

  function recordEvent(job: DriverJobWorkspaceItem, eventType: DeliveryClientEventType, details: DeliveryEventDetails = {}) {
    try {
      const validatedDetails = validateDeliveryEventDetails(
        eventType,
        details,
        job.lines.map((line) => ({ id: line.id, plannedQuantity: line.plannedQuantity })),
      );
      const pendingLatest = [...queueRef.current]
        .reverse()
        .find((event) => event.deliveryJobId === job.id && isStateChangingDriverEvent(event.eventType));
      const progress = (pendingLatest?.eventType ?? localStatus[job.id] ?? job.lastEvent ?? job.status) as DeliveryProgressStatus;
      if (isStateChangingDriverEvent(eventType) && progress === eventType) {
        setSyncMessage(copy.alreadyLatest(copy.eventLabels[eventType]));
        return;
      }
      if (!canRecordDriverEvent(progress, eventType)) {
        setSyncState("error");
        setSyncMessage(copy.updateNotSaved);
        return;
      }
      const event = createDriverOfflineEvent({
        deliveryJobId: job.id,
        assignmentId: job.assignmentId,
        deviceId: currentDeviceId(),
        clientEventId: crypto.randomUUID(),
        deviceSequence: nextSequence(),
        eventType,
        clientRecordedAt: new Date().toISOString(),
        ...validatedDetails,
      });
      updateQueue(enqueueDriverOfflineEvent(queueRef.current, event));
      if (isStateChangingDriverEvent(eventType)) {
        setLocalStatus((current) => ({ ...current, [job.id]: eventType }));
      }
      setSyncMessage(navigator.onLine ? copy.statusSavedSyncing : copy.statusSavedOffline);
      void syncPending();
    } catch {
      setSyncState("error");
      setSyncMessage(copy.updateNotSaved);
    }
  }

  function addNote(event: FormEvent<HTMLFormElement>, job: DriverJobWorkspaceItem) {
    event.preventDefault();
    const form = event.currentTarget;
    const note = String(new FormData(form).get("note") ?? "").trim();
    if (!note) return;
    recordEvent(job, "NOTE_ADDED", { note });
    form.reset();
  }

  function recordOutcome(event: FormEvent<HTMLFormElement>, job: DriverJobWorkspaceItem) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const eventType = submitter instanceof HTMLButtonElement
      ? submitter.value as DeliveryClientEventType
      : undefined;
    if (eventType !== "DELIVERED" && eventType !== "PARTIALLY_DELIVERED") return;
    const values = new FormData(form);
    const lineIds = values.getAll("deliveryJobLineId").map(String);
    const delivered = values.getAll("deliveredQuantity").map(Number);
    const damaged = values.getAll("damagedQuantity").map(Number);
    const missing = values.getAll("missingQuantity").map(Number);
    if (lineIds.length !== job.lines.length
      || [delivered, damaged, missing].some((items) => items.length !== lineIds.length)) return;
    recordEvent(job, eventType, {
      receiverName: String(values.get("receiverName") ?? ""),
      lineOutcomes: lineIds.map((deliveryJobLineId, index) => ({
        deliveryJobLineId,
        deliveredQuantity: delivered[index],
        damagedQuantity: damaged[index],
        missingQuantity: missing[index],
      })),
    });
  }

  function recordIssue(event: FormEvent<HTMLFormElement>, job: DriverJobWorkspaceItem) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const eventType = submitter instanceof HTMLButtonElement
      ? submitter.value as DeliveryClientEventType
      : undefined;
    if (eventType !== "DELIVERY_ATTEMPTED" && eventType !== "ISSUE_REPORTED" && eventType !== "FAILED") return;
    const values = new FormData(form);
    recordEvent(job, eventType, {
      issueCode: String(values.get("issueCode") ?? "") as DeliveryIssueCode,
      note: String(values.get("note") ?? ""),
    });
  }

  async function uploadEvidence(event: FormEvent<HTMLFormElement>, job: DriverJobWorkspaceItem) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get("file");
    const eventId = eventIds[job.id];
    if (!(file instanceof File) || !file.size || !eventId) return;
    const signature = `${file.name}:${file.size}:${file.lastModified}`;
    const previous = evidenceRetryRef.current[job.id];
    const attempt = previous?.signature === signature ? previous : {
      signature,
      clientEvidenceId: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
    };
    evidenceRetryRef.current[job.id] = attempt;
    setEvidenceState((current) => ({ ...current, [job.id]: copy.uploadingEvidence }));
    const body = new FormData();
    body.set("deliveryJobId", job.id);
    body.set("eventId", eventId);
    body.set("clientEvidenceId", attempt.clientEvidenceId);
    body.set("capturedAt", attempt.capturedAt);
    body.set("file", file);
    try {
      const response = await fetch("/api/driver/evidence", { method: "POST", body });
      if (!response.ok) throw new Error(copy.evidenceUploadFailed);
      delete evidenceRetryRef.current[job.id];
      setEvidenceState((current) => ({ ...current, [job.id]: copy.evidenceUploaded }));
      form.reset();
    } catch (error) {
      setEvidenceState((current) => ({
        ...current,
        [job.id]: error instanceof Error
          ? `${error.message} ${copy.evidenceRetry}`
          : copy.evidencePausedRetry,
      }));
    }
  }

  return (
    <>
      <section className={styles.syncBar} aria-live="polite">
        <div className={online === false ? styles.offline : styles.online}>
          {online === false ? <CloudOff size={18} /> : <RefreshCw size={18} className={syncState === "syncing" ? styles.spinning : undefined} />}
          <span><strong>{online === false ? copy.offline : syncState === "syncing" ? copy.syncing : copy.online}</strong><small>{copy.updatesWaiting(queue.length)}</small></span>
        </div>
        <button className="button button-secondary" type="button" onClick={() => void syncPending()} disabled={online === false || syncState === "syncing" || Boolean(queueRecovery)}>{copy.syncNow}</button>
      </section>
      {syncMessage ? <p className={syncState === "error" ? "form-alert" : "form-success"} role="status">{syncMessage}</p> : null}
      {queueRecovery ? (
        <section className={styles.queueRecovery} role="alert" aria-labelledby="driver-queue-recovery-title">
          <div className={styles.queueRecoveryHeading}>
            <ShieldAlert size={22} aria-hidden="true" />
            <div>
              <h2 id="driver-queue-recovery-title">{copy.queueRecoveryTitle}</h2>
              <p>{copy.queueRecoveryBody}</p>
            </div>
          </div>
          <p className={styles.queueRecoveryDetail}>
            {copy.queueRecoveryDetail(queueRecovery.events.length, queueRecovery.totalEventCount)}
          </p>
          <p className={styles.queueRecoveryPrivacy}>{copy.queueRecoveryPrivacy}</p>
          <div className={styles.queueRecoveryActions}>
            <button className="button button-secondary" type="button" onClick={retryQueueRecovery}><RefreshCw size={16} aria-hidden="true" />{copy.retryQueueValidation}</button>
            <button className="button button-secondary" type="button" onClick={exportQueueRecovery}><Download size={16} aria-hidden="true" />{copy.exportQueueRecovery}</button>
            <button className="button button-danger" type="button" onClick={() => setConfirmDiscard(true)}><Trash2 size={16} aria-hidden="true" />{copy.discardQueueRecovery}</button>
          </div>
          {confirmDiscard ? (
            <div className={styles.queueDiscardConfirmation} role="group" aria-label={copy.confirmDiscardTitle}>
              <strong>{copy.confirmDiscardTitle}</strong>
              <p>{copy.confirmDiscardBody}</p>
              <div>
                <button className="button button-secondary" type="button" onClick={() => setConfirmDiscard(false)}>{copy.cancelDiscard}</button>
                <button className="button button-danger" type="button" onClick={discardQueueRecovery}>{copy.confirmDiscard}</button>
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
      {jobs.length === 0 ? <section className={`${styles.empty} panel`}><h2>{copy.emptyTitle}</h2><p>{copy.emptyBody}</p></section> : (
        <div className={styles.cardList}>
          {jobs.map((job) => {
            const pendingForJob = queue.filter((event) => event.deliveryJobId === job.id).length;
            const progress = (localStatus[job.id] ?? job.lastEvent ?? job.status) as DeliveryProgressStatus;
            const currentEvent = localStatus[job.id] ?? job.lastEvent as DeliveryClientEventType | undefined;
            return (
              <article className={styles.workCard} key={job.id}>
                <header className={styles.cardHeader}>
                  <div><span className={styles.reference}>{job.jobCode}</span><h2>{job.branchName}</h2></div>
                  <span className={styles.mobileStatus}>{currentEvent ? copy.eventLabels[currentEvent] : formatRolePortalStatus(job.assignmentStatus, locale)}</span>
                </header>
                <div className={styles.address}><MapPin size={19} aria-hidden="true" /><div><strong>{job.address}</strong><span>{job.contactName} · <a href={`tel:${job.contactPhone}`}>{job.contactPhone}</a></span><a className={styles.navigationLink} href={buildDeliveryNavigationUrl(job.address)} target="_blank" rel="noopener noreferrer"><Navigation size={15} aria-hidden="true" />{copy.navigate}</a></div></div>
                <dl className={styles.factGrid}>
                  <div><dt>{copy.windowStarts}</dt><dd>{formatRolePortalDateTime(job.windowStart, locale, copy.notScheduled, timeZone)}</dd></div>
                  <div><dt>{copy.windowEnds}</dt><dd>{formatRolePortalDateTime(job.windowEnd, locale, copy.notScheduled, timeZone)}</dd></div>
                </dl>
                <div className={styles.package}><PackageCheck size={18} aria-hidden="true" /><span><strong>{copy.packages}</strong>{job.packageSummary}</span></div>
                {job.instructions ? <div className={styles.specification}><strong>{copy.instructions}</strong><p>{job.instructions}</p></div> : null}
                <div className={styles.driverActions} aria-label={copy.updateJob(job.jobCode)}>
                  <button type="button" disabled={!canRecordDriverEvent(progress, "ACCEPTED")} onClick={() => recordEvent(job, "ACCEPTED")}>{copy.accept}</button>
                  <button type="button" disabled={!canRecordDriverEvent(progress, "REJECTED")} className={styles.issueAction} onClick={() => recordEvent(job, "REJECTED")}>{copy.reject}</button>
                  <button type="button" disabled={!canRecordDriverEvent(progress, "EN_ROUTE")} onClick={() => recordEvent(job, "EN_ROUTE")}><Route size={16} aria-hidden="true" />{copy.enRoute}</button>
                  <button type="button" disabled={!canRecordDriverEvent(progress, "ARRIVED")} onClick={() => recordEvent(job, "ARRIVED")}>{copy.arrived}</button>
                </div>
                <p className={styles.pendingNote}>{pendingForJob ? copy.queuedUpdates(pendingForJob) : job.lastEventAt ? copy.lastConfirmed(formatRolePortalDateTime(job.lastEventAt, locale, copy.notScheduled, timeZone)) : copy.noStatus}</p>
                <details className={styles.utilityPanel}>
                  <summary>{copy.deliveryOutcome}</summary>
                  <form onSubmit={(event) => recordOutcome(event, job)} className={styles.compactForm}>
                    <label>{copy.reportedReceiverName}<input name="receiverName" required minLength={2} maxLength={200} autoComplete="off" /></label>
                    <div className={styles.driverOutcomeLines}>
                      {job.lines.map((line) => (
                        <fieldset key={line.id}>
                          <legend>{line.productName} · {line.plannedQuantity} {line.unit}</legend>
                          <input type="hidden" name="deliveryJobLineId" value={line.id} />
                          <div className={styles.lineQuantities}>
                            <label>{copy.deliveredQuantity}<input name="deliveredQuantity" type="number" min="0" max={line.plannedQuantity} step="0.001" required defaultValue={line.plannedQuantity} /></label>
                            <label>{copy.damagedQuantity}<input name="damagedQuantity" type="number" min="0" max={line.plannedQuantity} step="0.001" required defaultValue="0" /></label>
                            <label>{copy.missingQuantity}<input name="missingQuantity" type="number" min="0" max={line.plannedQuantity} step="0.001" required defaultValue="0" /></label>
                          </div>
                        </fieldset>
                      ))}
                    </div>
                    <p className={styles.hint}>{copy.evidenceOnly}</p>
                    <div className={styles.formActions}>
                      <button type="submit" name="eventType" value="PARTIALLY_DELIVERED" className="button button-secondary" disabled={!canRecordDriverEvent(progress, "PARTIALLY_DELIVERED")}>{copy.partiallyDelivered}</button>
                      <button type="submit" name="eventType" value="DELIVERED" className="button button-primary" disabled={!canRecordDriverEvent(progress, "DELIVERED")}>{copy.delivered}</button>
                    </div>
                  </form>
                </details>
                <details className={styles.utilityPanel}>
                  <summary>{copy.issueReport}</summary>
                  <form onSubmit={(event) => recordIssue(event, job)} className={styles.compactForm}>
                    <label>{copy.issueReason}<select name="issueCode" required defaultValue=""><option value="" disabled>—</option>{DELIVERY_ISSUE_CODES.map((code) => <option key={code} value={code}>{copy.issueLabels[code]}</option>)}</select></label>
                    <label>{copy.issueNote}<textarea name="note" required minLength={3} maxLength={1000} placeholder={copy.issueNotePlaceholder} /></label>
                    <div className={styles.formActions}>
                      <button type="submit" name="eventType" value="DELIVERY_ATTEMPTED" className="button button-secondary" disabled={!canRecordDriverEvent(progress, "DELIVERY_ATTEMPTED")}>{copy.recordAttempt}</button>
                      <button type="submit" name="eventType" value="ISSUE_REPORTED" className="button button-secondary" disabled={!canRecordDriverEvent(progress, "ISSUE_REPORTED")}>{copy.reportIssue}</button>
                      <button type="submit" name="eventType" value="FAILED" className="button button-secondary" disabled={!canRecordDriverEvent(progress, "FAILED")}>{copy.failed}</button>
                    </div>
                  </form>
                </details>
                <details className={styles.utilityPanel}>
                  <summary>{copy.addNote}</summary>
                  <form onSubmit={(event) => addNote(event, job)} className={styles.compactForm}><label>{copy.operationalNote}<textarea name="note" required maxLength={1000} /></label><button type="submit" className="button button-secondary">{copy.saveNoteOffline}</button></form>
                </details>
                <details className={styles.utilityPanel}>
                  <summary><Upload size={16} aria-hidden="true" /> {copy.uploadEvidence}</summary>
                  <form onSubmit={(event) => void uploadEvidence(event, job)} className={styles.compactForm}>
                    <label>{copy.photoOrDeliveryNote}<input name="file" type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" /></label>
                    <p className={styles.hint}>{pendingForJob ? copy.syncBeforeEvidence : copy.evidenceHint}</p>
                    <button type="submit" className="button button-secondary" disabled={!eventIds[job.id] || pendingForJob > 0 || online === false}>{copy.uploadEvidenceButton}</button>
                    {evidenceState[job.id] ? <p className={styles.inlineState} role="status">{evidenceState[job.id]}</p> : null}
                  </form>
                </details>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
