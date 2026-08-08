"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { deliveryWorkflowMessages } from "@/lib/delivery-workflow-i18n";
import styles from "./DeliveryExecution.module.css";

type Line = {
  id: string; requestLineId: string; productId: string; productName: string;
  quantity: number; unitOfMeasure: string; selectedSupplierId?: string | null;
};
type Event = { id: string; type: string; receivedAt: string; metadata?: Record<string, unknown> };
type Evidence = { id: string; type: string; fileName: string; version: number; accessUrl?: string };
type Job = {
  id: string; code: string; status: string; workflowVersion: number;
  assignmentId: string; requestId: string; requestNumber: string;
  branchName: string; destinationTimezone: string; scheduledLocalStart?: string;
  scheduledLocalEnd?: string; acceptanceDeadline?: string; slaDueAt?: string;
  proofPolicy: string[]; proofSatisfied: boolean; address: string;
  vehicle?: string; shift?: string; zone?: string; lines: Line[];
  events: Event[]; evidence: Evidence[]; actualHistory: Array<{ id: string; state: string }>;
};
type Workspace = {
  actorId: string; capturedAt: string;
  products: Array<{ id: string; name: string }>;
  suppliers: Array<{ id: string; name: string }>;
  jobs: Job[];
};
type QueuedCommand = {
  version: 2; queuedAt: string; payload: Record<string, unknown>;
};
type LegacyQueue = {
  raw: string; validCount: number; totalCount: number;
  needsAttention: boolean; message: string;
};

const MAX_QUEUE_ITEMS = 500;
const MAX_QUEUE_BYTES = 2 * 1024 * 1024;

function locale() {
  if (typeof document === "undefined") return "en";
  const value = document.documentElement.lang;
  return value === "ar" || value === "ms" ? value : "en";
}

function formatDate(value: string | undefined, timeZone?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale(), {
    dateStyle: "medium", timeStyle: "short", timeZone,
  }).format(new Date(value));
}

function storageKey(actorId: string) {
  return `axora:delivery-commands:v2:${actorId}`;
}

function legacyStorageKey(actorId: string) {
  return `axora:driver:${actorId}:event-queue:v1`;
}

function nextDeviceSequence() {
  return Date.now();
}

function validQueue(value: unknown): value is QueuedCommand[] {
  return Array.isArray(value) && value.length <= MAX_QUEUE_ITEMS && value.every((item) => (
    item && typeof item === "object"
    && (item as QueuedCommand).version === 2
    && typeof (item as QueuedCommand).queuedAt === "string"
    && (item as QueuedCommand).payload
    && typeof (item as QueuedCommand).payload === "object"
    && typeof (item as QueuedCommand).payload.commandId === "string"
    && typeof (item as QueuedCommand).payload.expectedVersion === "number"
  ));
}

function validLegacyEvent(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return ["deliveryJobId", "assignmentId", "deviceId", "clientEventId"]
    .every((key) => typeof item[key] === "string" && uuidPattern.test(item[key] as string))
    && typeof item.deviceSequence === "number"
    && typeof item.eventType === "string"
    && typeof item.clientRecordedAt === "string";
}

function inspectLegacyQueue(raw: string, actorId: string): LegacyQueue {
  try {
    const parsed: unknown = JSON.parse(raw);
    let events: unknown[];
    if (Array.isArray(parsed)) events = parsed;
    else if (parsed && typeof parsed === "object") {
      const envelope = parsed as Record<string, unknown>;
      if (envelope.schema !== "axora.driver-offline-events"
        || envelope.version !== 1
        || envelope.driverId !== actorId
        || !Array.isArray(envelope.events)) {
        return { raw, validCount: 0, totalCount: 0, needsAttention: true, message: "The saved data could not be read." };
      }
      events = envelope.events;
    } else throw new Error("invalid queue");
    const validCount = events.filter(validLegacyEvent).length;
    if (!events.length || validCount !== events.length) {
      return {
        raw, validCount, totalCount: events.length, needsAttention: true,
        message: `${validCount} of ${events.length} saved items passed validation.`,
      };
    }
    return { raw, validCount, totalCount: events.length, needsAttention: false, message: "" };
  } catch {
    return { raw, validCount: 0, totalCount: 0, needsAttention: true, message: "The saved data could not be read." };
  }
}

function availableEvents(job: Job) {
  switch (job.status) {
    case "ASSIGNED": return ["ACCEPTED", "REJECTED"];
    case "ACCEPTED": return ["SHOPPING_STARTED", "ISSUE_REPORTED"];
    case "SHOPPING": return ["ISSUE_REPORTED", "NOTE_ADDED"];
    case "ITEMS_ACQUIRED": return ["OUT_FOR_DELIVERY", "ISSUE_REPORTED"];
    case "OUT_FOR_DELIVERY": return ["ARRIVED", "FAILED", "ISSUE_REPORTED"];
    case "ARRIVED": return ["DELIVERED", "PARTIALLY_DELIVERED", "FAILED", "ISSUE_REPORTED"];
    case "PARTIALLY_DELIVERED": return ["DELIVERED", "COMPLETED", "ISSUE_REPORTED"];
    case "DELIVERED": return ["COMPLETED", "ISSUE_REPORTED"];
    default: return [];
  }
}

export function DeliveryExecutionPanel({ locale: initialLocale = "en" }: { locale?: "en" | "ar" | "ms" }) {
  const copy = deliveryWorkflowMessages(initialLocale);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [queue, setQueue] = useState<QueuedCommand[]>([]);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [legacyQueue, setLegacyQueue] = useState<LegacyQueue | null>(null);
  const [confirmLegacyDiscard, setConfirmLegacyDiscard] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const refresh = useCallback(async () => {
    const response = await fetch("/api/driver/workspace", { cache: "no-store" });
    if (!response.ok) throw new Error("Delivery workspace unavailable");
    const next = await response.json() as Workspace;
    setWorkspace(next);
    const legacyRaw = localStorage.getItem(legacyStorageKey(next.actorId));
    setLegacyQueue(legacyRaw ? inspectLegacyQueue(legacyRaw, next.actorId) : null);
    const raw = localStorage.getItem(storageKey(next.actorId));
    if (!raw) {
      setQueue([]);
      setRecovery(null);
      return;
    }
    if (raw.length > MAX_QUEUE_BYTES) {
      setRecovery(raw);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!validQueue(parsed)) throw new Error("invalid queue");
      setQueue(parsed);
      setRecovery(null);
    } catch {
      setRecovery(raw);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => setError("Delivery workspace unavailable"));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refresh]);

  const persist = useCallback((next: QueuedCommand[]) => {
    if (!workspace) return;
    const serialized = JSON.stringify(next);
    if (next.length > MAX_QUEUE_ITEMS || serialized.length > MAX_QUEUE_BYTES) {
      setError("Offline command queue limit reached");
      return;
    }
    localStorage.setItem(storageKey(workspace.actorId), serialized);
    setQueue(next);
  }, [workspace]);

  const flush = useCallback(async (items = queue) => {
    if (!workspace || !navigator.onLine || !items.length || busy) return;
    setBusy(true);
    setNotice(copy.retrying);
    let remaining = [...items];
    try {
      while (remaining.length) {
        const response = await fetch("/api/driver/workflow", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify(remaining[0].payload),
        });
        if (!response.ok) throw new Error("conflict");
        remaining = remaining.slice(1);
        persist(remaining);
      }
      setNotice(copy.saved);
      await refresh();
    } catch {
      setError("A retained command needs review against the current server version.");
    } finally {
      setBusy(false);
    }
  }, [busy, copy.retrying, copy.saved, persist, queue, refresh, workspace]);

  useEffect(() => {
    const online = () => { void flush(); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [flush]);

  const sendEvent = async (job: Job, type: string) => {
    const note = notes[job.id]?.trim() ?? "";
    const metadata: Record<string, unknown> = {};
    if (["REJECTED", "FAILED", "ISSUE_REPORTED"].includes(type)) {
      metadata.note = note;
      metadata.issueCode = type === "REJECTED" ? undefined : "OTHER";
    } else if (type === "NOTE_ADDED" && note) metadata.note = note;
    if (type === "PARTIALLY_DELIVERED") {
      metadata.receiverName = note || "Receiving representative";
      metadata.lineOutcomes = job.lines.map((line) => ({
        deliveryJobLineId: line.id,
        deliveredQuantity: Number((document.getElementById(`partial-${job.id}-${line.id}`) as HTMLInputElement | null)?.value ?? 0),
        damagedQuantity: 0,
        missingQuantity: Math.max(line.quantity - Number((document.getElementById(`partial-${job.id}-${line.id}`) as HTMLInputElement | null)?.value ?? 0), 0),
      }));
    }
    const deviceKey = `axora:delivery-device:${workspace?.actorId}`;
    const existingDevice = localStorage.getItem(deviceKey);
    const deviceId = existingDevice ?? crypto.randomUUID();
    if (!existingDevice) localStorage.setItem(deviceKey, deviceId);
    const command: QueuedCommand = { version: 2, queuedAt: new Date().toISOString(), payload: {
      jobId: job.id, assignmentId: job.assignmentId,
      expectedVersion: job.workflowVersion, commandId: crypto.randomUUID(),
      deviceId, deviceSequence: nextDeviceSequence(), eventType: type,
      clientRecordedAt: new Date().toISOString(), metadata,
    } };
    const next = [...queue, command];
    persist(next);
    if (navigator.onLine) await flush(next);
    else setNotice(copy.offline);
  };

  const submitShopping = async (event: FormEvent<HTMLFormElement>, job: Job) => {
    event.preventDefault();
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    form.set("requestId", job.requestId);
    form.set("idempotencyKey", crypto.randomUUID());
    const lines = job.lines.map((line) => ({
      requestLineId: line.requestLineId,
      actualProductId: form.get(`product-${line.id}`),
      supplierId: form.get(`supplier-${line.id}`),
      quantity: form.get(`quantity-${line.id}`),
      actualBuyUnitPrice: form.get(`price-${line.id}`),
      taxRate: form.get(`tax-${line.id}`) || 0,
      deliveryCharge: 0, otherCharge: 0,
      substituteReason: form.get(`substitute-${line.id}`) || "",
      notes: form.get(`line-note-${line.id}`) || "",
    }));
    form.set("lines", JSON.stringify(lines));
    try {
      const response = await fetch("/api/driver/shopping", { method: "POST", body: form });
      if (!response.ok) throw new Error("shopping");
      setNotice(copy.saved); await refresh();
    } catch { setError("Shopping record could not be committed."); }
    finally { setBusy(false); }
  };

  const uploadProof = async (event: FormEvent<HTMLFormElement>, job: Job) => {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    form.set("jobId", job.id); form.set("clientEvidenceId", crypto.randomUUID());
    form.set("capturedAt", new Date().toISOString());
    form.set("consented", form.get("consented") ? "true" : "false");
    try {
      const response = await fetch("/api/driver/proof", { method: "POST", body: form });
      if (!response.ok) throw new Error("proof");
      setNotice(copy.saved); await refresh();
    } catch { setError("Delivery proof could not be committed."); }
    finally { setBusy(false); }
  };

  const verifyOtp = async (event: FormEvent<HTMLFormElement>, job: Job) => {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/driver/otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        jobId: job.id, challengeId: form.get("challengeId"), code: form.get("code"),
      }) });
      if (!response.ok || !(await response.json() as { verified: boolean }).verified) throw new Error("otp");
      setNotice(copy.saved); await refresh();
    } catch { setError("Delivery confirmation code is invalid or unavailable."); }
    finally { setBusy(false); }
  };

  const jobs = useMemo(() => workspace?.jobs ?? [], [workspace]);
  return <section className={styles.shell} aria-label={copy.driverTitle}>
    <div className={styles.toolbar}>
      <div><span className={styles.eyebrow}>P1-08 · P1-09 · P1-10</span><strong>{copy.driverTitle}</strong></div>
      <button className={styles.compactButton} type="button" onClick={() => void refresh()}>{copy.refresh}</button>
    </div>
    {queue.length ? <p className={styles.notice} role="status">{copy.offline} ({queue.length})</p> : null}
    {legacyQueue && !legacyQueue.needsAttention ? <p className={styles.notice} role="status">{legacyQueue.validCount} update waiting</p> : null}
    {legacyQueue?.needsAttention ? <div className={styles.recovery} role="alert">
      <h2>Saved delivery updates need attention</h2>
      <p>{legacyQueue.message}</p>
      <p>Nothing was changed or deleted.</p>
      <div className={styles.actions}>
        <button type="button" disabled>Sync now</button>
        <button type="button" onClick={() => workspace && setLegacyQueue(inspectLegacyQueue(legacyQueue.raw, workspace.actorId))}>Retry validation</button>
        <button type="button" onClick={() => {
          const link = document.createElement("a");
          link.href = URL.createObjectURL(new Blob([legacyQueue.raw], { type: "application/json" }));
          link.download = `axora-delivery-queue-recovery-${new Date().toISOString().slice(0, 10)}.json`;
          link.click(); URL.revokeObjectURL(link.href);
        }}>Download recovery file</button>
        <button type="button" onClick={() => setConfirmLegacyDiscard(true)}>Discard local copy</button>
      </div>
      {confirmLegacyDiscard ? <div role="group" aria-label="Discard this saved copy?" className={styles.actions}>
        <button type="button" onClick={() => setConfirmLegacyDiscard(false)}>Keep saved copy</button>
        <button type="button" onClick={() => {
          if (workspace) localStorage.removeItem(legacyStorageKey(workspace.actorId));
          setLegacyQueue(null); setConfirmLegacyDiscard(false);
          setNotice("Saved delivery updates were discarded after confirmation.");
        }}>Confirm discard</button>
      </div> : null}
    </div> : null}
    {recovery ? <div className={styles.recovery} role="alert"><p>{copy.recover}</p><button type="button" onClick={() => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([recovery], { type: "application/json" }));
      link.download = "axora-delivery-command-recovery.json"; link.click(); URL.revokeObjectURL(link.href);
    }}>{copy.exportQueue}</button></div> : null}
    {notice ? <p className={styles.success} role="status">{notice}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {!workspace ? <p className={styles.notice}>Loading…</p> : jobs.length === 0
      ? <div className={styles.notice}><h2>{copy.noJobs}</h2></div>
      : <div className={styles.jobList}>{jobs.map((job) => <article className={styles.job} key={job.id}>
        <header className={styles.jobHeader}><div><p>{job.requestNumber} · {job.branchName}</p><h2>{job.code}</h2></div><span className={styles.state}>{job.status.replaceAll("_", " ")}</span></header>
        <div className={styles.jobBody}>
          <dl className={styles.facts}>
            <div className={styles.fact}><dt>{copy.schedule}</dt><dd>{job.scheduledLocalStart?.replace("T", " ")} – {job.scheduledLocalEnd?.slice(11, 16)}<br />{job.destinationTimezone}</dd></div>
            <div className={styles.fact}><dt>{copy.deadline}</dt><dd>{formatDate(job.acceptanceDeadline, job.destinationTimezone)}</dd></div>
            <div className={styles.fact}><dt>{copy.sla}</dt><dd>{formatDate(job.slaDueAt, job.destinationTimezone)}</dd></div>
            <div className={styles.fact}><dt>{copy.proof}</dt><dd>{job.proofPolicy.join(" + ")}<br />{job.proofSatisfied ? copy.proofReady : copy.proofMissing}</dd></div>
          </dl>
          <p>{job.address}</p>
          <label>{copy.note}<textarea value={notes[job.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [job.id]: event.target.value }))} maxLength={1000} /></label>
          {job.status === "ARRIVED" ? <div className={styles.formGrid}>{job.lines.map((line) => <label key={line.id}>{line.productName}<input id={`partial-${job.id}-${line.id}`} type="number" min="0" max={line.quantity} step="0.001" defaultValue={line.quantity} /></label>)}</div> : null}
          <div className={styles.actions}>{availableEvents(job).map((type) => <button className={styles.actionButton} data-primary={["ACCEPTED", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED"].includes(type)} disabled={busy || (type === "COMPLETED" && !job.proofSatisfied)} key={type} type="button" onClick={() => void sendEvent(job, type)}>{({
            ACCEPTED: copy.accept, REJECTED: copy.reject, SHOPPING_STARTED: copy.startShopping,
            OUT_FOR_DELIVERY: copy.outForDelivery, ARRIVED: copy.arrived,
            PARTIALLY_DELIVERED: copy.partial, DELIVERED: copy.delivered,
            COMPLETED: copy.completed, ISSUE_REPORTED: copy.reportIssue,
            FAILED: copy.reportIssue, NOTE_ADDED: copy.note,
          } as Record<string, string>)[type] ?? type}</button>)}</div>
          {["SHOPPING", "AWAITING_SUBSTITUTE_APPROVAL", "AWAITING_ADDITIONAL_APPROVAL"].includes(job.status) ? <details className={styles.details} open={job.status === "SHOPPING"}><summary>{copy.shopping}</summary><form className={styles.form} onSubmit={(event) => void submitShopping(event, job)}>
            <div className={styles.formGrid}><label>Mode<select name="purchaseMode" defaultValue="FINAL"><option>FINAL</option><option>PARTIAL</option><option>REFUND</option></select></label><label>{copy.note}<input name="notes" minLength={3} maxLength={2000} required /></label><label>{copy.receipt}<input name="receipt" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required /></label></div>
            {job.lines.map((line) => <div className={styles.lineEditor} key={line.id}><strong>{line.productName}<br />{line.quantity} {line.unitOfMeasure}</strong><label>Actual product<select name={`product-${line.id}`} defaultValue={line.productId}>{workspace.products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select></label><label>Supplier<select name={`supplier-${line.id}`} defaultValue={line.selectedSupplierId ?? ""} required><option value="" disabled>—</option>{workspace.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><label>Quantity<input name={`quantity-${line.id}`} type="number" min="0.001" step="0.001" defaultValue={line.quantity} required /></label><label>Buy price<input name={`price-${line.id}`} type="number" min="0" step="0.000001" required /></label><label>Tax %<input name={`tax-${line.id}`} type="number" min="0" max="100" step="0.01" defaultValue="0" /></label><label>Substitute reason<input name={`substitute-${line.id}`} maxLength={1000} /></label><label>Line note<input name={`line-note-${line.id}`} maxLength={2000} /></label></div>)}
            <button className={styles.actionButton} data-primary="true" disabled={busy} type="submit">{copy.submitShopping}</button>
          </form></details> : null}
          {job.events.length ? <details className={styles.details}><summary>{copy.uploadProof}</summary><form className={styles.form} onSubmit={(event) => void uploadProof(event, job)}><div className={styles.formGrid}><label>Event<select name="eventId" required>{[...job.events].reverse().map((item) => <option key={item.id} value={item.id}>{item.type}</option>)}</select></label><label>Type<select name="type" defaultValue="PHOTO"><option>PHOTO</option><option>SIGNATURE</option><option>DELIVERY_NOTE</option></select></label><label>File<input name="file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" required /></label><label>{copy.recipient}<input name="recipientIdentity" maxLength={200} /></label><label><input name="consented" type="checkbox" /> {copy.consent}</label><label>Correct evidence<select name="supersedesEvidenceId" defaultValue=""><option value="">—</option>{job.evidence.map((item) => <option key={item.id} value={item.id}>{item.type} v{item.version}</option>)}</select></label></div><button className={styles.actionButton} type="submit">{copy.uploadProof}</button></form></details> : null}
          {job.proofPolicy.includes("OTP") ? <details className={styles.details}><summary>{copy.verifyOtp}</summary><form className={styles.form} onSubmit={(event) => void verifyOtp(event, job)}><div className={styles.formGrid}><label>Challenge ID<input name="challengeId" required /></label><label>{copy.code}<input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required /></label></div><button className={styles.actionButton} type="submit">{copy.verifyOtp}</button></form></details> : null}
          {job.evidence.length ? <ul>{job.evidence.map((item) => <li key={item.id}>{item.accessUrl ? <a href={item.accessUrl}>{item.type} · {item.fileName} · v{item.version}</a> : item.fileName}</li>)}</ul> : null}
          <details className={styles.details}><summary>{copy.timeline}</summary><ol className={styles.timeline}>{job.events.map((item) => <li className={styles.timelineItem} key={item.id}><strong>{item.type.replaceAll("_", " ")}</strong><time>{formatDate(item.receivedAt, job.destinationTimezone)}</time></li>)}</ol></details>
        </div>
      </article>)}</div>}
  </section>;
}
