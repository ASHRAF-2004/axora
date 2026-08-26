"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { deliveryProofTypeLabel, deliveryWorkflowMessages, deliveryWorkflowStatusLabel, type DeliveryWorkflowLocale } from "@/lib/delivery-workflow-i18n";
import { DriverTrackingPanel } from "./DeliveryTrackingPanels";
import styles from "./DeliveryExecution.module.css";

type Line = {
  id: string; requestLineId: string; productId: string; productName: string;
  quantity: number; unitOfMeasure: string;
};
type Event = { id: string; type: string; receivedAt: string; metadata?: Record<string, unknown> };
type Evidence = { id: string; type: string; fileName: string; version: number; accessUrl?: string };
type Job = {
  id: string; code: string; status: string; workflowVersion: number;
  assignmentId: string; requestId: string; requestNumber: string;
  branchName: string; companyName?: string; destinationTimezone: string; scheduledLocalStart?: string;
  scheduledLocalEnd?: string; acceptanceDeadline?: string; slaDueAt?: string;
  proofPolicy: string[]; proofSatisfied: boolean; address: string;
  destinationLatitude?: number; destinationLongitude?: number;
  instructions?: string;
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
  version: 2;
  queuedAt: string;
  submissionState?: "READY" | "UNCERTAIN" | "REJECTED";
  payload: Record<string, unknown>;
};
type LegacyQueue = {
  raw: string; validCount: number; totalCount: number;
  needsAttention: boolean; message: string;
};
type DeliveryCommandResultKind = "EVENT" | "ACQUISITION" | "EVIDENCE" | "OTP";
type PendingCommandReference = {
  version: 1;
  kind: DeliveryCommandResultKind;
  jobId: string;
  commandId: string;
  relatedCommandId?: string;
  recordedAt: string;
};
type WorkflowSubmission =
  | { state: "COMMITTED"; result: Record<string, unknown> }
  | { state: "REJECTED"; status: number }
  | { state: "UNCERTAIN" };

const MAX_QUEUE_ITEMS = 500;
const MAX_QUEUE_BYTES = 2 * 1024 * 1024;
const MAX_PENDING_COMMANDS = 50;
const MAX_PENDING_COMMAND_BYTES = 32 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OFFLINE_EVENT_TYPES = new Set([
  "ACCEPTED", "SHOPPING_STARTED", "OUT_FOR_DELIVERY", "ARRIVED", "COMPLETED",
]);
const OFFLINE_PAYLOAD_KEYS = new Set([
  "jobId", "assignmentId", "expectedVersion", "commandId", "deviceId",
  "deviceSequence", "eventType", "clientRecordedAt", "metadata",
]);

function formatDate(value: string | undefined, locale: DeliveryWorkflowLocale, timeZone?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium", timeStyle: "short", timeZone,
  }).format(new Date(value));
}

function storageKey(actorId: string) {
  return `axora:delivery-commands:v2:${actorId}`;
}

function legacyStorageKey(actorId: string) {
  return `axora:driver:${actorId}:event-queue:v1`;
}

function reconciliationStorageKey(actorId: string) {
  return `axora:delivery-reconciliation:v1:${actorId}`;
}

function nextDeviceSequence() {
  return Date.now();
}

function validQueue(value: unknown): value is QueuedCommand[] {
  return Array.isArray(value) && value.length <= MAX_QUEUE_ITEMS && value.every((item) => (
    item && typeof item === "object"
    && (item as QueuedCommand).version === 2
    && typeof (item as QueuedCommand).queuedAt === "string"
    && (
      (item as QueuedCommand).submissionState === undefined
      || ["READY", "UNCERTAIN", "REJECTED"].includes(
        (item as QueuedCommand).submissionState!,
      )
    )
    && (item as QueuedCommand).payload
    && typeof (item as QueuedCommand).payload === "object"
    && Object.keys((item as QueuedCommand).payload)
      .every((key) => OFFLINE_PAYLOAD_KEYS.has(key))
    && UUID_PATTERN.test(String((item as QueuedCommand).payload.jobId ?? ""))
    && UUID_PATTERN.test(String((item as QueuedCommand).payload.assignmentId ?? ""))
    && UUID_PATTERN.test(String((item as QueuedCommand).payload.commandId ?? ""))
    && UUID_PATTERN.test(String((item as QueuedCommand).payload.deviceId ?? ""))
    && Number.isSafeInteger((item as QueuedCommand).payload.expectedVersion)
    && Number((item as QueuedCommand).payload.expectedVersion) > 0
    && Number.isSafeInteger((item as QueuedCommand).payload.deviceSequence)
    && Number((item as QueuedCommand).payload.deviceSequence) >= 0
    && OFFLINE_EVENT_TYPES.has(String((item as QueuedCommand).payload.eventType ?? ""))
    && typeof (item as QueuedCommand).payload.clientRecordedAt === "string"
    && Number.isFinite(Date.parse(String((item as QueuedCommand).payload.clientRecordedAt)))
    && (item as QueuedCommand).payload.metadata !== null
    && typeof (item as QueuedCommand).payload.metadata === "object"
    && !Array.isArray((item as QueuedCommand).payload.metadata)
    && Object.keys((item as QueuedCommand).payload.metadata as Record<string, unknown>).length === 0
  ));
}

function validPendingCommands(value: unknown): value is PendingCommandReference[] {
  return Array.isArray(value) && value.length <= MAX_PENDING_COMMANDS
    && value.every((item) => {
      if (!item || typeof item !== "object") return false;
      const command = item as PendingCommandReference;
      return command.version === 1
        && ["EVENT", "ACQUISITION", "EVIDENCE", "OTP"].includes(command.kind)
        && UUID_PATTERN.test(command.jobId)
        && UUID_PATTERN.test(command.commandId)
        && (command.relatedCommandId === undefined
          || UUID_PATTERN.test(command.relatedCommandId))
        && (command.kind !== "ACQUISITION"
          || typeof command.relatedCommandId === "string")
        && typeof command.recordedAt === "string";
    });
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

function inspectLegacyQueue(raw: string, actorId: string, copy: ReturnType<typeof deliveryWorkflowMessages>): LegacyQueue {
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
        return { raw, validCount: 0, totalCount: 0, needsAttention: true, message: copy.legacyUnreadable };
      }
      events = envelope.events;
    } else throw new Error("invalid queue");
    const validCount = events.filter(validLegacyEvent).length;
    if (!events.length || validCount !== events.length) {
      return {
        raw, validCount, totalCount: events.length, needsAttention: true,
        message: copy.legacyValidation.replace("{valid}", String(validCount)).replace("{total}", String(events.length)),
      };
    }
    return { raw, validCount, totalCount: events.length, needsAttention: false, message: "" };
  } catch {
    return { raw, validCount: 0, totalCount: 0, needsAttention: true, message: copy.legacyUnreadable };
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
    case "PARTIALLY_DELIVERED": return ["ISSUE_REPORTED"];
    case "DELIVERED": return ["COMPLETED", "ISSUE_REPORTED"];
    default: return [];
  }
}

function authoritativeJobResult(
  payload: unknown,
  expectedJobId?: string,
): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const envelope = payload as Record<string, unknown>;
  const value = envelope.event && typeof envelope.event === "object"
    ? envelope.event as Record<string, unknown> : envelope;
  return typeof value.jobId === "string"
    && (expectedJobId === undefined || value.jobId === expectedJobId)
    && typeof value.status === "string"
    && typeof value.workflowVersion === "number"
    ? value
    : null;
}

async function submitWorkflow(payload: Record<string, unknown>): Promise<WorkflowSubmission> {
  let response: Response;
  try {
    response = await fetch("/api/driver/workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { state: "UNCERTAIN" };
  }
  if (!response.ok) {
    return response.status >= 500
      ? { state: "UNCERTAIN" }
      : { state: "REJECTED", status: response.status };
  }
  try {
    const result: unknown = await response.json();
    const expectedJobId = typeof payload.jobId === "string" ? payload.jobId : undefined;
    return authoritativeJobResult(result, expectedJobId)
      ? { state: "COMMITTED", result: result as Record<string, unknown> }
      : { state: "UNCERTAIN" };
  } catch {
    return { state: "UNCERTAIN" };
  }
}

export function DeliveryExecutionPanel({ locale: initialLocale = "en" }: { locale?: DeliveryWorkflowLocale }) {
  const copy = deliveryWorkflowMessages(initialLocale);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [queue, setQueue] = useState<QueuedCommand[]>([]);
  const [recovery, setRecovery] = useState<string | null>(null);
  const [legacyQueue, setLegacyQueue] = useState<LegacyQueue | null>(null);
  const [confirmLegacyDiscard, setConfirmLegacyDiscard] = useState(false);
  const [confirmRecoveryDiscard, setConfirmRecoveryDiscard] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<Record<string, "ACQUIRED" | "UNAVAILABLE">>({});
  const [proofTypes, setProofTypes] = useState<Record<string, "PHOTO" | "SIGNATURE">>({});
  const [pendingCommands, setPendingCommands] = useState<PendingCommandReference[]>([]);
  const reconciliationTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/driver/workspace", { cache: "no-store" });
    if (!response.ok) throw new Error("Delivery workspace unavailable");
    const next = await response.json() as Workspace;
    setWorkspace(next);
    const legacyRaw = localStorage.getItem(legacyStorageKey(next.actorId));
    setLegacyQueue(legacyRaw ? inspectLegacyQueue(legacyRaw, next.actorId, copy) : null);
    let pendingRecovery: string | null = null;
    const reconciliationRaw = localStorage.getItem(reconciliationStorageKey(next.actorId));
    if (!reconciliationRaw) {
      setPendingCommands([]);
    } else {
      try {
        if (reconciliationRaw.length > MAX_PENDING_COMMAND_BYTES) {
          throw new Error("oversized reconciliation queue");
        }
        const parsed: unknown = JSON.parse(reconciliationRaw);
        if (!validPendingCommands(parsed)) throw new Error("invalid reconciliation queue");
        setPendingCommands(parsed);
      } catch {
        pendingRecovery = reconciliationRaw;
        setPendingCommands([]);
      }
    }
    const raw = localStorage.getItem(storageKey(next.actorId));
    if (!raw) {
      setQueue([]);
      setRecovery(pendingRecovery);
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
      setRecovery(pendingRecovery);
    } catch {
      setRecovery(raw);
    }
  }, [copy]);

  const applyAuthoritativeJobResult = useCallback((payload: unknown, expectedJobId?: string) => {
    const value = authoritativeJobResult(payload, expectedJobId);
    if (!value) return false;
    window.dispatchEvent(new CustomEvent("axora:delivery-progressed", {
      detail: { jobId: value.jobId, status: value.status },
    }));
    if (typeof value.status === "string" && [
      "COMPLETED", "CANCELLED", "FAILED", "RETURNED",
    ].includes(value.status)) {
      window.dispatchEvent(new CustomEvent("axora:delivery-terminal", {
        detail: { jobId: value.jobId, status: value.status },
      }));
    }
    setWorkspace((current) => current ? {
      ...current,
      jobs: current.jobs.map((job) => job.id === value.jobId ? {
        ...job,
        ...(typeof value.status === "string" ? { status: value.status } : {}),
        ...(typeof value.workflowVersion === "number"
          ? { workflowVersion: value.workflowVersion } : {}),
      } : job),
    } : current);
    return true;
  }, []);

  const readCommandResult = useCallback(async (
    kind: DeliveryCommandResultKind,
    jobId: string,
    commandId: string,
    relatedCommandId?: string,
  ) => {
    const parameters = new URLSearchParams({ kind, jobId, commandId });
    if (relatedCommandId) parameters.set("relatedCommandId", relatedCommandId);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const response = await fetch(`/api/driver/command-result?${parameters}`, {
          cache: "no-store",
          credentials: "same-origin",
        });
        if (response.ok) return await response.json() as Record<string, unknown>;
        if (response.status !== 404 && response.status < 500) return null;
      } catch { /* The command transaction may still be committing. */ }
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, Math.min(400 * (2 ** attempt), 3_000));
      });
    }
    return null;
  }, []);

  const refreshAfterCommit = useCallback(async () => {
    const retry = (attempt: number) => {
      reconciliationTimer.current = window.setTimeout(() => {
        void refresh().then(() => setNotice(copy.saved)).catch(() => {
          setNotice(copy.savedRefreshing);
          if (attempt < 5) retry(attempt + 1);
        });
      }, Math.min(1_500 * (2 ** attempt), 15_000));
    };
    try {
      await refresh();
    } catch {
      setNotice(copy.savedRefreshing);
      if (reconciliationTimer.current !== null) {
        window.clearTimeout(reconciliationTimer.current);
      }
      retry(0);
    }
  }, [copy.saved, copy.savedRefreshing, refresh]);

  useEffect(() => () => {
    if (reconciliationTimer.current !== null) {
      window.clearTimeout(reconciliationTimer.current);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => setError(copy.workspaceUnavailable));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [copy.workspaceUnavailable, refresh]);

  useEffect(() => {
    const claimed = () => { void refresh().catch(() => setError(copy.workspaceUnavailable)); };
    window.addEventListener("axora:delivery-claimed", claimed);
    return () => window.removeEventListener("axora:delivery-claimed", claimed);
  }, [copy.workspaceUnavailable, refresh]);

  const persist = useCallback((next: QueuedCommand[]) => {
    if (!workspace) return;
    if (!next.length) {
      localStorage.removeItem(storageKey(workspace.actorId));
      setQueue([]);
      return;
    }
    const serialized = JSON.stringify(next);
    if (next.length > MAX_QUEUE_ITEMS || serialized.length > MAX_QUEUE_BYTES) {
      setError(copy.queueLimit);
      return;
    }
    localStorage.setItem(storageKey(workspace.actorId), serialized);
    setQueue(next);
  }, [copy.queueLimit, workspace]);

  const persistPendingCommands = useCallback((next: PendingCommandReference[]) => {
    if (!workspace) return;
    if (!next.length) {
      localStorage.removeItem(reconciliationStorageKey(workspace.actorId));
      setPendingCommands([]);
      return;
    }
    if (next.length > MAX_PENDING_COMMANDS) {
      setError(copy.queueLimit);
      return;
    }
    localStorage.setItem(reconciliationStorageKey(workspace.actorId), JSON.stringify(next));
    setPendingCommands(next);
  }, [copy.queueLimit, workspace]);

  const rememberPendingCommand = useCallback((command: PendingCommandReference) => {
    const exists = pendingCommands.some((item) => (
      item.kind === command.kind && item.commandId === command.commandId
    ));
    if (!exists && pendingCommands.length >= MAX_PENDING_COMMANDS) {
      setError(copy.queueLimit);
      return false;
    }
    const next = [
      ...pendingCommands.filter((item) => !(
        item.kind === command.kind && item.commandId === command.commandId
      )),
      command,
    ];
    persistPendingCommands(next);
    return true;
  }, [copy.queueLimit, pendingCommands, persistPendingCommands]);

  const forgetPendingCommand = useCallback((command: PendingCommandReference) => {
    persistPendingCommands(pendingCommands.filter((item) => !(
      item.kind === command.kind && item.commandId === command.commandId
    )));
  }, [pendingCommands, persistPendingCommands]);

  const flush = useCallback(async (items = queue) => {
    if (!workspace || !navigator.onLine || !items.length || busy) return;
    setBusy(true);
    setError("");
    setNotice(copy.retrying);
    let remaining = [...items];
    try {
      while (remaining.length) {
        let pending = remaining[0];
        if (pending.submissionState === "REJECTED") {
          remaining = remaining.slice(1);
          persist(remaining);
          void refresh().catch(() => undefined);
          throw new Error("conflict");
        }
        let result: Record<string, unknown> | null = null;
        if (pending.submissionState === "UNCERTAIN") {
          result = await readCommandResult(
            "EVENT",
            String(pending.payload.jobId),
            String(pending.payload.commandId),
          );
        } else {
          const submitted = await submitWorkflow(pending.payload);
          if (submitted.state === "REJECTED" && submitted.status !== 409) {
            remaining = remaining.slice(1);
            persist(remaining);
            void refresh().catch(() => undefined);
            throw new Error("conflict");
          }
          if (submitted.state === "COMMITTED") result = submitted.result;
          else {
            pending = { ...pending, submissionState: "UNCERTAIN" };
            remaining = [pending, ...remaining.slice(1)];
            persist(remaining);
            result = await readCommandResult(
              "EVENT",
              String(pending.payload.jobId),
              String(pending.payload.commandId),
            );
            if (!result && submitted.state === "REJECTED") {
              remaining = remaining.slice(1);
              persist(remaining);
              void refresh().catch(() => undefined);
              throw new Error("conflict");
            }
          }
        }
        if (!result || !applyAuthoritativeJobResult(
          result,
          String(pending.payload.jobId),
        )) {
          throw new Error("unconfirmed");
        }
        remaining = remaining.slice(1);
        persist(remaining);
      }
      setNotice(copy.saved);
      void refreshAfterCommit();
    } catch (flushError) {
      if (flushError instanceof Error && flushError.message === "unconfirmed") {
        setNotice(copy.outcomeUnconfirmed);
      } else {
        setError(copy.retainedConflict);
      }
    } finally {
      setBusy(false);
    }
  }, [applyAuthoritativeJobResult, busy, copy.outcomeUnconfirmed, copy.retainedConflict, copy.retrying, copy.saved, persist, queue, readCommandResult, refresh, refreshAfterCommit, workspace]);

  const reconcilePendingCommands = useCallback(async () => {
    if (!workspace || !navigator.onLine || !pendingCommands.length || busy) return;
    setBusy(true);
    setError("");
    setNotice(copy.checkingOutcome);
    let remaining = [...pendingCommands];
    let confirmedAny = false;
    const confirmedAfterRefresh: PendingCommandReference[] = [];
    try {
      for (const command of pendingCommands) {
        const result = await readCommandResult(
          command.kind,
          command.jobId,
          command.commandId,
          command.relatedCommandId,
        );
        const confirmed = command.kind === "EVENT" || command.kind === "ACQUISITION"
          ? applyAuthoritativeJobResult(result, command.jobId)
          : command.kind === "EVIDENCE"
            ? typeof result?.evidenceId === "string"
            : typeof result?.verified === "boolean";
        if (!confirmed) continue;
        if (command.kind === "OTP" && result?.verified !== true) {
          setError(copy.otpError);
        }
        confirmedAny = true;
        const requiresWorkspaceRefresh = command.kind === "EVIDENCE"
          || (command.kind === "OTP" && result?.verified === true);
        if (requiresWorkspaceRefresh) {
          confirmedAfterRefresh.push(command);
        } else {
          remaining = remaining.filter((item) => !(
            item.kind === command.kind && item.commandId === command.commandId
          ));
          persistPendingCommands(remaining);
        }
      }
      if (confirmedAny) {
        try {
          await refresh();
        } catch {
          setNotice(copy.savedRefreshing);
          return;
        }
      }
      if (confirmedAfterRefresh.length) {
        remaining = remaining.filter((item) => !confirmedAfterRefresh.some((confirmed) => (
          confirmed.kind === item.kind && confirmed.commandId === item.commandId
        )));
        persistPendingCommands(remaining);
      }
      setNotice(remaining.length ? copy.outcomeUnconfirmed : copy.saved);
    } finally {
      setBusy(false);
    }
  }, [applyAuthoritativeJobResult, busy, copy.checkingOutcome, copy.otpError, copy.outcomeUnconfirmed, copy.saved, copy.savedRefreshing, pendingCommands, persistPendingCommands, readCommandResult, refresh, workspace]);

  useEffect(() => {
    const online = () => { void flush(); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [flush]);

  const sendEvent = async (job: Job, type: string) => {
    setNotice("");
    setError("");
    if (type === "COMPLETED") {
      window.dispatchEvent(new CustomEvent("axora:delivery-completion-pending", {
        detail: { jobId: job.id },
      }));
    }
    const note = notes[job.id]?.trim() ?? "";
    const metadata: Record<string, unknown> = {};
    if (["REJECTED", "FAILED", "ISSUE_REPORTED"].includes(type)) {
      metadata.note = note;
      metadata.issueCode = type === "REJECTED" ? undefined : "OTHER";
    } else if (type === "NOTE_ADDED" && note) metadata.note = note;
    if (type === "PARTIALLY_DELIVERED") {
      metadata.receiverName = note;
      metadata.lineOutcomes = job.lines.map((line) => ({
        deliveryJobLineId: line.id,
        deliveredQuantity: Number((document.getElementById(`partial-${job.id}-${line.id}`) as HTMLInputElement | null)?.value ?? 0),
        damagedQuantity: 0,
        missingQuantity: Math.max(line.quantity - Number((document.getElementById(`partial-${job.id}-${line.id}`) as HTMLInputElement | null)?.value ?? 0), 0),
      }));
    }
    if (type === "DELIVERED") {
      metadata.receiverName = note;
      metadata.lineOutcomes = job.lines.map((line) => ({
        deliveryJobLineId: line.id,
        deliveredQuantity: line.quantity,
        damagedQuantity: 0,
        missingQuantity: 0,
      }));
    }
    const deviceKey = `axora:delivery-device:${workspace?.actorId}`;
    const existingDevice = localStorage.getItem(deviceKey);
    const deviceId = existingDevice ?? crypto.randomUUID();
    if (!existingDevice) localStorage.setItem(deviceKey, deviceId);
    const command: QueuedCommand = {
      version: 2,
      queuedAt: new Date().toISOString(),
      submissionState: "READY",
      payload: {
      jobId: job.id, assignmentId: job.assignmentId,
      expectedVersion: job.workflowVersion, commandId: crypto.randomUUID(),
      deviceId, deviceSequence: nextDeviceSequence(), eventType: type,
      clientRecordedAt: new Date().toISOString(), metadata,
      },
    };
    // Recipient identity, handover quantities and free-text operational notes
    // are never persisted to localStorage. These commands require a live
    // request and an uncertain response is reconciled by command id.
    if (Object.keys(metadata).length) {
      if (!navigator.onLine) {
        setError(copy.commandConflict);
        return;
      }
      const pendingReference: PendingCommandReference = {
        version: 1,
        kind: "EVENT",
        jobId: job.id,
        commandId: String(command.payload.commandId),
        recordedAt: new Date().toISOString(),
      };
      if (!rememberPendingCommand(pendingReference)) return;
      setBusy(true);
      const submitted = await submitWorkflow(command.payload);
      if (submitted.state === "REJECTED" && submitted.status !== 409) {
        forgetPendingCommand(pendingReference);
        setError(copy.commandConflict);
        setBusy(false);
        return;
      }
      let result: Record<string, unknown> | null = submitted.state === "COMMITTED"
        ? submitted.result : null;
      if (!result) {
        setNotice(copy.checkingOutcome);
        result = await readCommandResult("EVENT", job.id, String(command.payload.commandId));
      }
      if (result && applyAuthoritativeJobResult(result, job.id)) {
        forgetPendingCommand(pendingReference);
        setNotice(copy.saved);
        void refreshAfterCommit();
      } else if (submitted.state === "REJECTED") {
        forgetPendingCommand(pendingReference);
        setError(copy.commandConflict);
      } else {
        setNotice(copy.outcomeUnconfirmed);
      }
      setBusy(false);
      return;
    }
    const next = [...queue, command];
    persist(next);
    if (navigator.onLine) await flush(next);
    else setNotice(copy.offline);
  };

  const submitAcquisition = async (event: FormEvent<HTMLFormElement>, job: Job) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const lines = job.lines.map((line) => {
      const resolution = String(form.get(`resolution-${line.id}`));
      return resolution === "UNAVAILABLE"
        ? { deliveryJobLineId: line.id, resolution, reason: "ITEM_UNAVAILABLE" }
        : { deliveryJobLineId: line.id, resolution: "ACQUIRED", actualInternalUnitCost: String(form.get(`cost-${line.id}`) ?? "") };
    });
    const deviceKey = `axora:delivery-device:${workspace?.actorId}`;
    const existingDevice = localStorage.getItem(deviceKey);
    const deviceId = existingDevice ?? crypto.randomUUID();
    if (!existingDevice) localStorage.setItem(deviceKey, deviceId);
    const commandId = crypto.randomUUID();
    const eventCommandId = crypto.randomUUID();
    const pendingReference: PendingCommandReference = {
      version: 1,
      kind: "ACQUISITION",
      jobId: job.id,
      commandId,
      relatedCommandId: eventCommandId,
      recordedAt: new Date().toISOString(),
    };
    if (!rememberPendingCommand(pendingReference)) {
      setBusy(false);
      return;
    }
    form.set("jobId", job.id);
    form.set("assignmentId", job.assignmentId);
    form.set("expectedVersion", String(job.workflowVersion));
    form.set("commandId", commandId);
    form.set("eventCommandId", eventCommandId);
    form.set("deviceId", deviceId);
    form.set("deviceSequence", String(nextDeviceSequence()));
    form.set("capturedAt", new Date().toISOString());
    form.set("lines", JSON.stringify(lines));
    try {
      let response: Response | null = null;
      try {
        response = await fetch("/api/driver/acquisition", { method: "POST", body: form });
      } catch { /* Reconcile the immutable acquisition command below. */ }
      if (response && !response.ok && response.status < 500
        && response.status !== 409) {
        forgetPendingCommand(pendingReference);
        setError(copy.shoppingError);
        return;
      }
      let result: Record<string, unknown> | null = null;
      if (response?.ok) {
        try {
          const body: unknown = await response.json();
          if (authoritativeJobResult(body, job.id)) result = body as Record<string, unknown>;
        } catch { /* Reconcile the committed command below. */ }
      }
      if (!result) {
        setNotice(copy.checkingOutcome);
        result = await readCommandResult(
          "ACQUISITION", job.id, commandId, eventCommandId,
        );
      }
      if (!result || !applyAuthoritativeJobResult(result, job.id)) {
        if (response && !response.ok && response.status === 409) {
          forgetPendingCommand(pendingReference);
          setError(copy.shoppingError);
        } else {
          setNotice(copy.outcomeUnconfirmed);
        }
        return;
      }
      forgetPendingCommand(pendingReference);
      setNotice(copy.saved);
      void refreshAfterCommit();
    } catch { setNotice(copy.outcomeUnconfirmed); }
    finally { setBusy(false); }
  };

  const uploadProof = async (event: FormEvent<HTMLFormElement>, job: Job) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const clientEvidenceId = crypto.randomUUID();
    const pendingReference: PendingCommandReference = {
      version: 1,
      kind: "EVIDENCE",
      jobId: job.id,
      commandId: clientEvidenceId,
      recordedAt: new Date().toISOString(),
    };
    if (!rememberPendingCommand(pendingReference)) {
      setBusy(false);
      return;
    }
    form.set("jobId", job.id); form.set("clientEvidenceId", clientEvidenceId);
    form.set("capturedAt", new Date().toISOString());
    form.set("consented", form.get("consented") ? "true" : "false");
    try {
      let response: Response | null = null;
      try {
        response = await fetch("/api/driver/proof", { method: "POST", body: form });
      } catch { /* Reconcile the immutable evidence id below. */ }
      if (response && !response.ok && response.status < 500
        && response.status !== 409) {
        forgetPendingCommand(pendingReference);
        setError(copy.proofError);
        return;
      }
      let result: Record<string, unknown> | null = null;
      if (response?.ok) {
        try {
          const body: unknown = await response.json();
          if (body && typeof body === "object"
            && typeof (body as Record<string, unknown>).evidenceId === "string") {
            result = body as Record<string, unknown>;
          }
        } catch { /* Reconcile the committed evidence below. */ }
      }
      if (!result) {
        setNotice(copy.checkingOutcome);
        result = await readCommandResult("EVIDENCE", job.id, clientEvidenceId);
      }
      const evidenceType = String(form.get("type"));
      const file = form.get("file");
      if (typeof result?.evidenceId === "string" && file instanceof File) {
        const evidenceId = result.evidenceId;
        const version = typeof result.version === "number" ? result.version : 1;
        setWorkspace((current) => current ? {
          ...current,
          jobs: current.jobs.map((item) => {
            if (item.id !== job.id) return item;
            const evidence = [...item.evidence, {
              id: evidenceId,
              type: evidenceType,
              fileName: file.name,
              version,
            }];
            const filePolicySatisfied = item.proofPolicy
              .filter((type) => type !== "OTP")
              .every((type) => evidence.some((proof) => proof.type === type));
            return {
              ...item,
              evidence,
              proofSatisfied: !item.proofPolicy.includes("OTP") && filePolicySatisfied,
            };
          }),
        } : current);
      } else {
        if (response && !response.ok && response.status === 409) {
          forgetPendingCommand(pendingReference);
          setError(copy.proofError);
        } else {
          setNotice(copy.outcomeUnconfirmed);
        }
        return;
      }
      forgetPendingCommand(pendingReference);
      setNotice(copy.saved);
      void refreshAfterCommit();
    } catch { setNotice(copy.outcomeUnconfirmed); }
    finally { setBusy(false); }
  };

  const verifyOtp = async (event: FormEvent<HTMLFormElement>, job: Job) => {
    event.preventDefault(); setBusy(true); setError(""); setNotice("");
    const form = new FormData(event.currentTarget);
    const commandId = crypto.randomUUID();
    const pendingReference: PendingCommandReference = {
      version: 1,
      kind: "OTP",
      jobId: job.id,
      commandId,
      recordedAt: new Date().toISOString(),
    };
    if (!rememberPendingCommand(pendingReference)) {
      setBusy(false);
      return;
    }
    try {
      let response: Response | null = null;
      try {
        response = await fetch("/api/driver/otp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          jobId: job.id, challengeId: form.get("challengeId"),
          code: form.get("code"), commandId,
        }) });
      } catch { /* Reconcile the idempotent OTP command below. */ }
      if (response && !response.ok && response.status < 500
        && response.status !== 409) {
        forgetPendingCommand(pendingReference);
        setError(copy.otpError);
        return;
      }
      let result: Record<string, unknown> | null = null;
      if (response?.ok) {
        try {
          const body: unknown = await response.json();
          if (body && typeof body === "object"
            && typeof (body as Record<string, unknown>).verified === "boolean") {
            result = body as Record<string, unknown>;
          }
        } catch { /* Reconcile the committed verification below. */ }
      }
      if (!result) {
        setNotice(copy.checkingOutcome);
        result = await readCommandResult("OTP", job.id, commandId);
      }
      if (!result) {
        if (response && !response.ok && response.status === 409) {
          forgetPendingCommand(pendingReference);
          setError(copy.otpError);
        } else {
          setNotice(copy.outcomeUnconfirmed);
        }
        return;
      }
      if (result.verified !== true) {
        forgetPendingCommand(pendingReference);
        setNotice("");
        setError(copy.otpError);
        return;
      }
      forgetPendingCommand(pendingReference);
      setWorkspace((current) => current ? {
        ...current,
        jobs: current.jobs.map((item) => {
          if (item.id !== job.id) return item;
          const filePolicySatisfied = item.proofPolicy
            .filter((type) => type !== "OTP")
            .every((type) => item.evidence.some((proof) => proof.type === type));
          return { ...item, proofSatisfied: filePolicySatisfied };
        }),
      } : current);
      setNotice(copy.saved);
      void refreshAfterCommit();
    } catch {
      setNotice(copy.outcomeUnconfirmed);
    }
    finally { setBusy(false); }
  };

  const jobs = useMemo(() => workspace?.jobs ?? [], [workspace]);
  const pendingJobIds = useMemo(() => {
    const result = new Set(pendingCommands.map((command) => command.jobId));
    for (const command of queue) {
      if (typeof command.payload.jobId === "string") result.add(command.payload.jobId);
    }
    return result;
  }, [pendingCommands, queue]);
  return <section className={styles.shell} aria-label={copy.driverTitle}>
    <div className={styles.toolbar}>
      <div><span className={styles.eyebrow}>{copy.driverTitle}</span><strong>{copy.driverTitle}</strong></div>
      <button className={styles.compactButton} type="button" onClick={() => {
        void refresh().catch(() => setError(copy.workspaceUnavailable));
      }}>{copy.refresh}</button>
    </div>
    {queue.length || pendingCommands.length ? <div className={styles.notice} role="status">
      <p>{pendingCommands.length ? copy.outcomeUnconfirmed : copy.offline} ({queue.length + pendingCommands.length})</p>
      <button className={styles.actionButton} disabled={busy} type="button" onClick={() => {
        if (!navigator.onLine) {
          setNotice(copy.offline);
          return;
        }
        void (async () => {
          if (queue.length) await flush();
          if (pendingCommands.length) await reconcilePendingCommands();
        })();
      }}>{copy.syncNow}</button>
    </div> : null}
    {legacyQueue && !legacyQueue.needsAttention ? <p className={styles.notice} role="status">{(legacyQueue.validCount === 1 ? copy.legacyWaitingOne : copy.legacyWaiting).replace("{count}", new Intl.NumberFormat(initialLocale).format(legacyQueue.validCount))}</p> : null}
    {legacyQueue?.needsAttention ? <div className={styles.recovery} role="alert">
      <h2>{copy.legacyTitle}</h2>
      <p>{legacyQueue.message}</p>
      <p>{copy.unchanged}</p>
      <div className={styles.actions}>
        <button type="button" disabled>{copy.syncNow}</button>
        <button type="button" onClick={() => workspace && setLegacyQueue(inspectLegacyQueue(legacyQueue.raw, workspace.actorId, copy))}>{copy.retryValidation}</button>
        <button type="button" onClick={() => {
          const link = document.createElement("a");
          link.href = URL.createObjectURL(new Blob([legacyQueue.raw], { type: "application/json" }));
          link.download = `axora-delivery-queue-recovery-${new Date().toISOString().slice(0, 10)}.json`;
          link.click(); URL.revokeObjectURL(link.href);
        }}>{copy.downloadRecovery}</button>
        <button type="button" onClick={() => setConfirmLegacyDiscard(true)}>{copy.discardLocal}</button>
      </div>
      {confirmLegacyDiscard ? <div role="group" aria-label={copy.discardQuestion} className={styles.actions}>
        <button type="button" onClick={() => setConfirmLegacyDiscard(false)}>{copy.keepSaved}</button>
        <button type="button" onClick={() => {
          if (workspace) localStorage.removeItem(legacyStorageKey(workspace.actorId));
          setLegacyQueue(null); setConfirmLegacyDiscard(false);
          setNotice(copy.discarded);
        }}>{copy.confirmDiscard}</button>
      </div> : null}
    </div> : null}
    {recovery ? <div className={styles.recovery} role="alert">
      <p>{copy.recover}</p>
      <div className={styles.actions}>
        <button type="button" onClick={() => {
          const link = document.createElement("a");
          link.href = URL.createObjectURL(new Blob([recovery], { type: "application/json" }));
          link.download = "axora-delivery-command-recovery.json";
          link.click();
          URL.revokeObjectURL(link.href);
        }}>{copy.exportQueue}</button>
        <button type="button" onClick={() => setConfirmRecoveryDiscard(true)}>
          {copy.discardLocal}
        </button>
      </div>
      {confirmRecoveryDiscard ? <div
        role="group"
        aria-label={copy.discardQuestion}
        className={styles.actions}
      >
        <button type="button" onClick={() => setConfirmRecoveryDiscard(false)}>
          {copy.keepSaved}
        </button>
        <button type="button" onClick={() => {
          if (workspace) {
            localStorage.removeItem(storageKey(workspace.actorId));
            localStorage.removeItem(reconciliationStorageKey(workspace.actorId));
          }
          setQueue([]);
          setPendingCommands([]);
          setRecovery(null);
          setConfirmRecoveryDiscard(false);
          setNotice(copy.discarded);
        }}>{copy.confirmDiscard}</button>
      </div> : null}
    </div> : null}
    {notice ? <p className={styles.success} role="status">{notice}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {workspace ? <DriverTrackingPanel actorId={workspace.actorId} deliveries={jobs.map((job) => ({
      id: job.id,
      address: job.address,
      destinationLatitude: job.destinationLatitude,
      destinationLongitude: job.destinationLongitude,
    }))} locale={initialLocale} /> : null}
    {!workspace ? <p className={styles.notice}>{copy.loading}</p> : jobs.length === 0
      ? <div className={styles.notice}><h2>{copy.noJobs}</h2></div>
      : <div className={styles.jobList}>{jobs.map((job) => {
        const jobBlocked = busy || Boolean(recovery) || pendingJobIds.has(job.id);
        const jobEvents = availableEvents(job);
        return <article className={styles.job} key={job.id}>
        <header className={styles.jobHeader}><div><p>{job.requestNumber}</p><h2>{job.code}</h2><small>{job.companyName ? `${job.companyName} · ` : ""}{job.branchName}</small></div><span className={styles.state}>{deliveryWorkflowStatusLabel(job.status, initialLocale)}</span></header>
        <div className={styles.jobBody}>
          <dl className={styles.facts}>
            <div className={styles.fact}><dt>{copy.schedule}</dt><dd>{job.scheduledLocalStart?.replace("T", " ")} – {job.scheduledLocalEnd?.slice(11, 16)}<br />{job.destinationTimezone}</dd></div>
            <div className={styles.fact}><dt>{copy.deadline}</dt><dd>{formatDate(job.acceptanceDeadline, initialLocale, job.destinationTimezone)}</dd></div>
            <div className={styles.fact}><dt>{copy.sla}</dt><dd>{formatDate(job.slaDueAt, initialLocale, job.destinationTimezone)}</dd></div>
            <div className={styles.fact}><dt>{copy.proof}</dt><dd>{job.proofPolicy.map((type) => deliveryProofTypeLabel(type, initialLocale)).join(" + ")}<br />{job.proofSatisfied ? copy.proofReady : copy.proofMissing}</dd></div>
          </dl>
          <ul className={styles.itemList}>{job.lines.map((line) => <li key={line.id}><strong>{line.productName}</strong><span>×{line.quantity} {line.unitOfMeasure}</span></li>)}</ul>
          <p>{job.address}</p>
          {job.instructions ? <p><strong>{copy.instructions}:</strong> {job.instructions}</p> : null}
          {jobEvents.length ? <label>{job.status === "ARRIVED" ? copy.recipient : copy.note}<textarea value={notes[job.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [job.id]: event.target.value }))} maxLength={1000} /></label> : null}
          {job.status === "SHOPPING" ? <details className={styles.details} open>
            <summary>{copy.shopping}</summary>
            <form className={styles.form} onSubmit={(event) => void submitAcquisition(event, job)}>
              <p className={styles.notice}>{copy.customerPriceFixed}</p>
              {job.lines.map((line) => <fieldset className={styles.lineEditor} key={line.id}>
                <legend>{line.productName} · {line.quantity} {line.unitOfMeasure}</legend>
                <label>{copy.resolution}<select name={`resolution-${line.id}`} value={resolutions[line.id] ?? "ACQUIRED"} onChange={(event) => setResolutions((current) => ({ ...current, [line.id]: event.target.value as "ACQUIRED" | "UNAVAILABLE" }))}><option value="ACQUIRED">{copy.acquired}</option><option value="UNAVAILABLE">{copy.itemUnavailable}</option></select></label>
                <label>{copy.internalCost}<input name={`cost-${line.id}`} inputMode="decimal" pattern="[0-9]+([.][0-9]{1,6})?" disabled={resolutions[line.id] === "UNAVAILABLE"} required={resolutions[line.id] !== "UNAVAILABLE"} /></label>
              </fieldset>)}
              <div className={styles.formGrid}><label>{copy.receipt}<input name="receipt" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" capture="environment" required /></label><label>{copy.note}<textarea name="notes" minLength={3} maxLength={2000} /></label></div>
              <button className={styles.actionButton} data-primary="true" disabled={jobBlocked} type="submit">{copy.submitBuying}</button>
            </form>
          </details> : null}
          {job.status === "ARRIVED" ? <div className={styles.formGrid}>{job.lines.map((line) => <label key={line.id}>{line.productName}<input id={`partial-${job.id}-${line.id}`} type="number" min="0" max={line.quantity} step="0.001" defaultValue={line.quantity} /></label>)}</div> : null}
          <div className={styles.actions}>{jobEvents.map((type) => <button className={styles.actionButton} data-primary={["ACCEPTED", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED"].includes(type)} disabled={jobBlocked || (["DELIVERED", "PARTIALLY_DELIVERED", "COMPLETED"].includes(type) && !job.proofSatisfied) || (["REJECTED", "FAILED", "ISSUE_REPORTED"].includes(type) && (notes[job.id]?.trim().length ?? 0) < 3) || (["DELIVERED", "PARTIALLY_DELIVERED"].includes(type) && (notes[job.id]?.trim().length ?? 0) < 2)} key={type} type="button" onClick={() => void sendEvent(job, type)}>{({
            ACCEPTED: copy.accept, REJECTED: copy.reject, SHOPPING_STARTED: copy.startBuying,
            ITEMS_ACQUIRED: copy.itemsAcquired,
            OUT_FOR_DELIVERY: copy.outForDelivery, ARRIVED: copy.arrived,
            PARTIALLY_DELIVERED: copy.partial, DELIVERED: copy.delivered,
            COMPLETED: copy.completed, ISSUE_REPORTED: copy.reportIssue,
            FAILED: copy.reportIssue, NOTE_ADDED: copy.note,
          } as Record<string, string>)[type] ?? copy.statusUnavailable}</button>)}</div>
          {["ARRIVED", "PARTIALLY_DELIVERED", "DELIVERED"].includes(job.status)
            && job.proofPolicy.some((type) => type === "PHOTO" || type === "SIGNATURE") ? <details className={styles.details}><summary>{copy.uploadProof}</summary><form className={styles.form} onSubmit={(event) => void uploadProof(event, job)}><div className={styles.formGrid}><label>{copy.event}<select name="eventId" required>{[...job.events].reverse().filter((item) => ["ARRIVED", "PARTIALLY_DELIVERED", "DELIVERED"].includes(item.type)).map((item) => <option key={item.id} value={item.id}>{deliveryWorkflowStatusLabel(item.type, initialLocale)}</option>)}</select></label><label>{copy.evidenceType}<select name="type" value={proofTypes[job.id] ?? (job.proofPolicy.includes("PHOTO") ? "PHOTO" : "SIGNATURE")} onChange={(event) => setProofTypes((current) => ({ ...current, [job.id]: event.target.value as "PHOTO" | "SIGNATURE" }))}>{job.proofPolicy.filter((type) => type === "PHOTO" || type === "SIGNATURE").map((type) => <option key={type} value={type}>{deliveryProofTypeLabel(type, initialLocale)}</option>)}</select></label><label>{copy.file}<input name="file" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" required /></label><label>{copy.recipient}<input name="recipientIdentity" minLength={2} maxLength={200} required /></label><label><input name="consented" type="checkbox" required={(proofTypes[job.id] ?? (job.proofPolicy.includes("PHOTO") ? "PHOTO" : "SIGNATURE")) === "SIGNATURE"} /> {copy.consent}</label><label>{copy.correctEvidence}<select name="supersedesEvidenceId" defaultValue=""><option value="">—</option>{job.evidence.map((item) => <option key={item.id} value={item.id}>{deliveryProofTypeLabel(item.type, initialLocale)} · {copy.version} {new Intl.NumberFormat(initialLocale).format(item.version)}</option>)}</select></label></div><button className={styles.actionButton} disabled={jobBlocked} type="submit">{copy.uploadProof}</button></form></details> : null}
          {job.proofPolicy.includes("OTP") ? <details className={styles.details}><summary>{copy.verifyOtp}</summary><form className={styles.form} onSubmit={(event) => void verifyOtp(event, job)}><div className={styles.formGrid}><label>{copy.challengeId}<input name="challengeId" required /></label><label>{copy.code}<input name="code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required /></label></div><button className={styles.actionButton} disabled={jobBlocked} type="submit">{copy.verifyOtp}</button></form></details> : null}
          {job.evidence.length ? <ul>{job.evidence.map((item) => <li key={item.id}>{item.accessUrl ? <a href={item.accessUrl}>{deliveryProofTypeLabel(item.type, initialLocale)} · {item.fileName} · {copy.version} {new Intl.NumberFormat(initialLocale).format(item.version)}</a> : item.fileName}</li>)}</ul> : null}
          <details className={styles.details}><summary>{copy.timeline}</summary><ol className={styles.timeline}>{job.events.map((item) => <li className={styles.timelineItem} key={item.id}><strong>{deliveryWorkflowStatusLabel(item.type, initialLocale)}</strong><time>{formatDate(item.receivedAt, initialLocale, job.destinationTimezone)}</time></li>)}</ol></details>
        </div>
      </article>;
      })}</div>}
  </section>;
}
