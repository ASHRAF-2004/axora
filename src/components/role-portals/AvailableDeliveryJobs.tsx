"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AvailableDeliveryWorkspace } from "@/lib/driver-operations";
import type { SupportedLocale } from "@/lib/i18n";
import styles from "./AvailableDeliveryJobs.module.css";

const copy = {
  en: {
    title: "Available delivery jobs",
    intro: "Claim one paid job when you are ready. The first eligible Delivery Agent to claim it is assigned the work.",
    claim: "Claim", empty: "No paid jobs are available.", conflict: "This job was already claimed.",
    failed: "The claim could not be recorded. You can try again.", live: "Live", offline: "Reconnecting",
    availability: "Availability", available: "Available", unavailable: "Unavailable",
    availabilitySaved: "Availability updated.", claimed: "Claim succeeded.",
    availabilityFailed: "Availability could not be confirmed. Refresh before changing it again.",
    availabilityRefreshing: "Availability updated. Refreshing available jobs…",
    refreshing: "Claim succeeded. Refreshing delivery workspace…",
    reconciling: "Checking the authoritative claim result…",
    reconciliationFailed: "The claim outcome is still being checked. Do not claim again.",
    job: "Job", company: "Company", area: "Area", items: "Items",
  },
  ar: {
    title: "مهام التسليم المتاحة",
    intro: "اختر مهمة مدفوعة عندما تكون مستعداً. تُسند المهمة إلى أول مسؤول توصيل مؤهل يختارها.",
    claim: "اختيار المهمة", empty: "لا توجد مهام مدفوعة متاحة.", conflict: "تم اختيار هذه المهمة بالفعل.",
    failed: "تعذر تسجيل اختيار المهمة. يمكنك المحاولة مرة أخرى.", live: "مباشر", offline: "إعادة الاتصال",
    availability: "التوفر", available: "متاح", unavailable: "غير متاح",
    availabilitySaved: "تم تحديث حالة التوفر.", claimed: "تم اختيار المهمة بنجاح.",
    availabilityFailed: "تعذر تأكيد حالة التوفر. حدّث الصفحة قبل تغييرها مرة أخرى.",
    availabilityRefreshing: "تم تحديث حالة التوفر. جارٍ تحديث المهام المتاحة…",
    refreshing: "تم اختيار المهمة. جارٍ تحديث مساحة عمل التسليم…",
    reconciling: "جارٍ التحقق من النتيجة المعتمدة لاختيار المهمة…",
    reconciliationFailed: "لا تزال نتيجة الاختيار قيد التحقق. لا تحاول اختيار المهمة مرة أخرى.",
    job: "المهمة", company: "الشركة", area: "المنطقة", items: "البنود",
  },
  ms: {
    title: "Kerja penghantaran tersedia",
    intro: "Tuntut satu kerja berbayar apabila bersedia. Kerja diberikan kepada Ejen Penghantaran layak yang pertama menuntutnya.",
    claim: "Tuntut", empty: "Tiada kerja berbayar tersedia.", conflict: "Kerja ini telah dituntut.",
    failed: "Tuntutan tidak dapat direkodkan. Anda boleh mencuba semula.", live: "Langsung", offline: "Menyambung semula",
    availability: "Ketersediaan", available: "Tersedia", unavailable: "Tidak tersedia",
    availabilitySaved: "Ketersediaan dikemas kini.", claimed: "Tuntutan berjaya.",
    availabilityFailed: "Ketersediaan tidak dapat disahkan. Muat semula sebelum mengubahnya lagi.",
    availabilityRefreshing: "Ketersediaan dikemas kini. Memuat semula kerja tersedia…",
    refreshing: "Tuntutan berjaya. Memuat semula ruang kerja penghantaran…",
    reconciling: "Menyemak keputusan tuntutan berwibawa…",
    reconciliationFailed: "Keputusan tuntutan masih disemak. Jangan tuntut sekali lagi.",
    job: "Kerja", company: "Syarikat", area: "Kawasan", items: "Item",
  },
} as const;

type ClaimResult = {
  assignmentId: string;
  jobId: string;
  status: "ASSIGNED";
  created: boolean;
};

type ExecutionWorkspace = { jobs?: Array<{ id?: string; assignmentId?: string }> };
type PendingClaim = {
  version: 1;
  jobId: string;
  commandId: string;
  recordedAt: string;
};
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function pendingClaimKey(actorId: string) {
  return `axora:delivery-claim:v1:${actorId}`;
}

function readPendingClaim(actorId: string): PendingClaim | null {
  const raw = localStorage.getItem(pendingClaimKey(actorId));
  if (!raw || raw.length > 2_048) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingClaim>;
    return value.version === 1
      && typeof value.jobId === "string" && UUID_PATTERN.test(value.jobId)
      && typeof value.commandId === "string" && UUID_PATTERN.test(value.commandId)
      && typeof value.recordedAt === "string"
      ? value as PendingClaim : null;
  } catch {
    return null;
  }
}

function isClaimResult(value: unknown): value is ClaimResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.assignmentId === "string"
    && typeof result.jobId === "string"
    && result.status === "ASSIGNED"
    && typeof result.created === "boolean";
}

export function AvailableDeliveryJobs({
  actorId,
  locale = "en",
}: {
  actorId: string;
  locale?: SupportedLocale;
}) {
  const text = copy[locale];
  const [workspace, setWorkspace] = useState<AvailableDeliveryWorkspace | null>(null);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sequence = useRef(0);
  const connectedRef = useRef(false);
  const claimedJobIds = useRef(new Set<string>());
  const retryTimer = useRef<number | null>(null);
  const restoredClaim = useRef(false);

  const normalize = useCallback((next: AvailableDeliveryWorkspace) => ({
    ...next,
    jobs: next.jobs.filter((job) => !claimedJobIds.current.has(job.id)),
  }), []);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/driver/jobs", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error("unavailable");
    const next = normalize(await response.json() as AvailableDeliveryWorkspace);
    setWorkspace(next);
    return next;
  }, [normalize]);

  const refreshAfterCommit = useCallback(async (
    delayed: string = text.refreshing,
    confirmed: string = text.claimed,
  ) => {
    const retry = (attempt: number) => {
      retryTimer.current = window.setTimeout(() => {
        void refresh().then(() => setNotice(confirmed)).catch(() => {
          setNotice(delayed);
          if (attempt < 5) retry(attempt + 1);
        });
      }, Math.min(1_500 * (2 ** attempt), 15_000));
    };
    try {
      await refresh();
    } catch {
      setNotice(delayed);
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
      retry(0);
    }
  }, [refresh, text.claimed, text.refreshing]);

  useEffect(() => () => {
    if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    const setLive = (value: boolean) => { connectedRef.current = value; setConnected(value); };
    const connect = () => {
      if (document.hidden || source) return;
      void refresh().catch(() => setLive(false));
      source = new EventSource("/api/driver/jobs/live", { withCredentials: true });
      source.addEventListener("snapshot", ((event: MessageEvent<string>) => {
        try {
          const envelope = JSON.parse(event.data) as { sequence: number; snapshot: AvailableDeliveryWorkspace };
          if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence <= sequence.current) return;
          sequence.current = envelope.sequence;
          setWorkspace(normalize(envelope.snapshot));
          setLive(true);
        } catch { setLive(false); }
      }) as EventListener);
      source.onerror = () => setLive(false);
    };
    const fallback = window.setInterval(() => {
      if (!connectedRef.current && document.visibilityState === "visible" && navigator.onLine) {
        void refresh().catch(() => undefined);
      }
    }, 30_000);
    const visibility = () => {
      if (document.hidden) { source?.close(); source = null; setLive(false); }
      else connect();
    };
    const online = () => connect();
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    connect();
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
      source?.close();
      window.clearInterval(fallback);
    };
  }, [normalize, refresh]);

  async function availability(value: "AVAILABLE" | "UNAVAILABLE") {
    setBusy("availability"); setError(""); setNotice("");
    try {
      const response = await fetch("/api/driver/availability", {
        method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ availability: value }),
      });
      if (!response.ok) {
        if (response.status >= 500) throw new Error("uncertain");
        setError(text.availabilityFailed);
        return;
      }
      const result = await response.json() as { availability?: AvailableDeliveryWorkspace["availability"] };
      if (result.availability !== "AVAILABLE" && result.availability !== "UNAVAILABLE") {
        throw new Error("uncertain");
      }
      const authoritativeAvailability = result.availability;
      setWorkspace((current) => current ? {
        ...current,
        availability: authoritativeAvailability,
        jobs: authoritativeAvailability === "AVAILABLE" ? current.jobs : [],
      } : current);
      setNotice(text.availabilitySaved);
      void refreshAfterCommit(text.availabilityRefreshing, text.availabilitySaved);
    } catch {
      setNotice(text.availabilityRefreshing);
      try {
        const authoritative = await refresh();
        if (authoritative.availability === value) setNotice(text.availabilitySaved);
        else {
          setNotice("");
          setError(text.availabilityFailed);
        }
      } catch {
        setNotice(text.availabilityRefreshing);
        setError(text.availabilityFailed);
      }
    }
    finally { setBusy(""); }
  }

  const commitClaim = useCallback((result: ClaimResult) => {
    localStorage.removeItem(pendingClaimKey(actorId));
    claimedJobIds.current.add(result.jobId);
    setWorkspace((current) => current ? {
      ...current,
      jobs: current.jobs.filter((job) => job.id !== result.jobId),
    } : current);
    setError("");
    setNotice(text.claimed);
    window.dispatchEvent(new CustomEvent("axora:delivery-claimed", { detail: result }));
    void refreshAfterCommit();
  }, [actorId, refreshAfterCommit, text.claimed]);

  const markClaimPending = useCallback((jobId: string) => {
    claimedJobIds.current.add(jobId);
    setWorkspace((current) => current ? {
      ...current,
      jobs: current.jobs.filter((job) => job.id !== jobId),
    } : current);
  }, []);

  async function reconcileUncertainClaim(jobId: string, commandId: string, attempt = 0) {
    try {
      const claimResponse = await fetch(
        `/api/driver/jobs/claim-result?jobId=${encodeURIComponent(jobId)}&commandId=${encodeURIComponent(commandId)}`,
        { cache: "no-store", credentials: "same-origin" },
      );
      if (claimResponse.ok) {
        try {
          const result: unknown = await claimResponse.json();
          if (isClaimResult(result) && result.jobId === jobId) {
            commitClaim(result);
            setBusy("");
            return;
          }
        } catch { /* Fall through to the assignment projection. */ }
      }
      const executionResponse = await fetch("/api/driver/workspace", {
        cache: "no-store", credentials: "same-origin",
      });
      if (executionResponse.ok) {
        const execution = await executionResponse.json() as ExecutionWorkspace;
        const assigned = execution.jobs?.find((job) => job.id === jobId);
        if (assigned?.assignmentId) {
          commitClaim({ assignmentId: assigned.assignmentId, jobId, status: "ASSIGNED", created: false });
          setBusy("");
          return;
        }
      }
      // A shared-pool read cannot prove that the original request failed: it
      // may race a transaction that is still committing, and absence cannot
      // distinguish our claim from another agent's. Keep the action hidden
      // and continue exact, read-only reconciliation.
      await refresh();
      if (attempt < 5) {
        setNotice(text.reconciling);
        retryTimer.current = window.setTimeout(
          () => void reconcileUncertainClaim(jobId, commandId, attempt + 1),
          Math.min(1_000 * (2 ** attempt), 10_000),
        );
      } else {
        setNotice(text.reconciliationFailed);
        setBusy("");
      }
    } catch {
      setNotice(text.reconciliationFailed);
      if (attempt < 5) {
        retryTimer.current = window.setTimeout(
          () => void reconcileUncertainClaim(jobId, commandId, attempt + 1),
          Math.min(1_000 * (2 ** attempt), 10_000),
        );
      } else setBusy("");
    }
  }

  async function claim(jobId: string) {
    setBusy(jobId); setError(""); setNotice("");
    const commandId = crypto.randomUUID();
    localStorage.setItem(pendingClaimKey(actorId), JSON.stringify({
      version: 1,
      jobId,
      commandId,
      recordedAt: new Date().toISOString(),
    } satisfies PendingClaim));
    let response: Response;
    try {
      response = await fetch("/api/driver/jobs", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId, commandId }),
      });
    } catch {
      markClaimPending(jobId);
      setNotice(text.reconciling);
      void reconcileUncertainClaim(jobId, commandId);
      return;
    }
    if (!response.ok) {
      let message = "";
      try {
        const failure = await response.json() as { error?: unknown };
        if (typeof failure.error === "string") message = failure.error;
      } catch { /* The status still determines whether the result is uncertain. */ }
      if (response.status === 409 && message === "This job was already claimed.") {
        // A second tab may have won for this same actor. Reconcile the
        // actor-owned assignment once before presenting the authoritative
        // conflict returned for this command.
        try {
          const executionResponse = await fetch("/api/driver/workspace", {
            cache: "no-store", credentials: "same-origin",
          });
          if (executionResponse.ok) {
            const execution = await executionResponse.json() as ExecutionWorkspace;
            const assigned = execution.jobs?.find((job) => job.id === jobId);
            if (assigned?.assignmentId) {
              commitClaim({
                assignmentId: assigned.assignmentId,
                jobId,
                status: "ASSIGNED",
                created: false,
              });
              setBusy("");
              return;
            }
          }
        } catch { /* The mutation's explicit conflict remains authoritative. */ }
        localStorage.removeItem(pendingClaimKey(actorId));
        setError(text.conflict);
        setBusy("");
        void refresh().catch(() => undefined);
        return;
      }
      if (response.status >= 500 || response.status === 409) {
        markClaimPending(jobId);
        setNotice(text.reconciling);
        void reconcileUncertainClaim(jobId, commandId);
        return;
      }
      localStorage.removeItem(pendingClaimKey(actorId));
      setError(message || text.failed);
      setBusy("");
      return;
    }
    try {
      const result: unknown = await response.json();
      if (!isClaimResult(result) || result.jobId !== jobId) throw new Error("uncertain");
      commitClaim(result);
      setBusy("");
    } catch {
      markClaimPending(jobId);
      setNotice(text.reconciling);
      void reconcileUncertainClaim(jobId, commandId);
    }
  }

  useEffect(() => {
    if (restoredClaim.current) return;
    restoredClaim.current = true;
    const timer = window.setTimeout(() => {
      const pending = readPendingClaim(actorId);
      if (!pending) return;
      markClaimPending(pending.jobId);
      setBusy(pending.jobId);
      setNotice(text.reconciling);
      void reconcileUncertainClaim(pending.jobId, pending.commandId);
    }, 0);
    return () => window.clearTimeout(timer);
  // Reconciliation functions deliberately retain their current localized
  // closure for this mounted portal instance.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId]);

  useEffect(() => {
    const synchronizeTabs = (event: StorageEvent) => {
      if (event.key !== pendingClaimKey(actorId)) return;
      const pending = readPendingClaim(actorId);
      if (!pending) {
        void refresh().catch(() => undefined);
        return;
      }
      markClaimPending(pending.jobId);
      setNotice(text.reconciling);
      void reconcileUncertainClaim(pending.jobId, pending.commandId);
    };
    window.addEventListener("storage", synchronizeTabs);
    return () => window.removeEventListener("storage", synchronizeTabs);
  // See the mounted-instance note above.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorId]);

  const available = workspace?.availability === "AVAILABLE";
  return <section className="panel" aria-labelledby="available-delivery-jobs">
    <div className="panel-header"><div><h2 id="available-delivery-jobs">{text.title}</h2><p>{text.intro}</p></div><span className="status-badge" role="status">{connected ? text.live : text.offline}</span></div>
    <div className={styles.availability} role="group" aria-label={text.availability}>
      <button className="button button-secondary" type="button" aria-pressed={available} disabled={Boolean(busy)} onClick={() => void availability("AVAILABLE")}>{text.available}</button>
      <button className="button button-secondary" type="button" aria-pressed={workspace ? !available : false} disabled={Boolean(busy)} onClick={() => void availability("UNAVAILABLE")}>{text.unavailable}</button>
    </div>
    {notice ? <p className={styles.success} role="status" aria-live="polite">{notice}</p> : null}
    {error ? <p className="callout" role="alert">{error}</p> : null}
    {!workspace?.jobs.length ? <p className="subtle">{text.empty}</p> : <div className={styles.jobs}>{workspace.jobs.map((job) => <article className={styles.job} key={job.id}>
      <div className={styles.jobHeading}><div><span>{text.job}</span><strong>{job.code}</strong><small>{job.requestReference}</small></div><span className="status-badge">{job.status}</span></div>
      <dl className={styles.facts}><div><dt>{text.company}</dt><dd>{job.companyName}<small>{job.branchName}</small></dd></div><div><dt>{text.area}</dt><dd>{job.area || "—"}</dd></div><div><dt>{text.items}</dt><dd>{job.lineCount}</dd></div></dl>
      <button className="button button-primary" disabled={Boolean(busy)} onClick={() => void claim(job.id)} type="button">{text.claim}</button>
    </article>)}</div>}
  </section>;
}
