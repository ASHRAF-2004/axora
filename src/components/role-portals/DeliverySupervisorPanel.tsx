"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { deliveryWorkflowMessages, deliveryWorkflowStatusLabel, type DeliveryWorkflowLocale } from "@/lib/delivery-workflow-i18n";
import styles from "./DeliveryExecution.module.css";
import { UserAvatar } from "@/components/UserAvatar";
import { DeliveryTrackingBoard } from "./DeliveryTrackingPanels";

type Agent = {
  userId: string; roleAssignmentId: string; name: string; email: string;
  activeJobs: number; overdueJobs: number;
};
type RequestOption = {
  id: string; number: string; companyName: string; branchName: string;
  branchTimezone: string; neededByDate: string;
};
type Assignment = {
  id: string; driverUserId: string; driverName: string;
  driverRoleAssignmentId: string; status: string; reason: string;
  vehicle?: string; shift?: string; zone?: string; assignedAt: string;
};
type Job = {
  id: string; code: string; status: string; workflowVersion: number;
  requestNumber: string; companyName: string; branchName: string;
  destinationTimezone: string; scheduledWindowStart?: string; scheduledWindowEnd?: string;
  scheduledLocalStart?: string; scheduledLocalEnd?: string; scheduledLocalDate?: string;
  acceptanceDeadline?: string; slaDueAt?: string; proofPolicy: string[];
  proofSatisfied: boolean; assignment?: Assignment | null;
  history: Assignment[];
};
type Workspace = { capturedAt: string; agents: Agent[]; requests: RequestOption[]; jobs: Job[] };
type Filter = "ALL" | "TODAY" | "TOMORROW";

function localDate(timeZone: string, offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  const parts = new Intl.DateTimeFormat("en", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function localDateTimeInput(value: string | undefined, timeZone: string) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const item = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${item.year}-${item.month}-${item.day}T${item.hour}:${item.minute}`;
}

export function DeliverySupervisorPanel({ locale = "en" }: { locale?: DeliveryWorkflowLocale }) {
  const copy = deliveryWorkflowMessages(locale);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const response = await fetch("/api/deliveries/workspace", { cache: "no-store" });
    if (!response.ok) throw new Error("workspace");
    setWorkspace(await response.json() as Workspace);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => setError(copy.workspaceUnavailable));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [copy.workspaceUnavailable, refresh]);

  const post = async (url: string, body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error("command");
      setNotice(copy.saved); await refresh();
    } catch { setError(copy.commandConflict); }
    finally { setBusy(false); }
  };

  const createJob = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void post("/api/deliveries/jobs", {
      requestId: form.get("requestId"), localStart: form.get("localStart"),
      localEnd: form.get("localEnd"), instructions: form.get("instructions"),
      idempotencyKey: crypto.randomUUID(), commandId: crypto.randomUUID(),
    });
  };

  const assign = (event: FormEvent<HTMLFormElement>, job: Job) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const agent = workspace?.agents.find((item) => item.roleAssignmentId === form.get("driverRoleAssignmentId"));
    if (!agent) return;
    void post("/api/deliveries/commands", {
      action: "ASSIGN", jobId: job.id, driverUserId: agent.userId,
      driverRoleAssignmentId: agent.roleAssignmentId,
      expectedVersion: job.workflowVersion, reason: form.get("reason"),
      acceptanceDeadline: form.get("acceptanceDeadline"), vehicle: form.get("vehicle"),
      shift: form.get("shift"), zone: form.get("zone"),
      destinationTimezone: job.destinationTimezone,
      proofPolicy: form.getAll("proofPolicy"), commandId: crypto.randomUUID(),
    });
  };

  const manage = (event: FormEvent<HTMLFormElement>, job: Job, operation: string) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void post("/api/deliveries/commands", {
      action: operation, operation, jobId: job.id, expectedVersion: job.workflowVersion,
      reason: form.get("reason"), localStart: form.get("localStart") || undefined,
      localEnd: form.get("localEnd") || undefined,
      destinationTimezone: job.destinationTimezone, commandId: crypto.randomUUID(),
    });
  };

  const jobs = useMemo(() => (workspace?.jobs ?? []).filter((job) => {
    if (filter === "ALL") return true;
    return job.scheduledLocalDate === localDate(job.destinationTimezone, filter === "TOMORROW" ? 1 : 0);
  }), [filter, workspace]);

  return <section className={styles.shell} aria-label={copy.supervisorTitle}>
    <div className={styles.toolbar}>
      <div className={styles.filters} aria-label={copy.schedule}>
        {(["ALL", "TODAY", "TOMORROW"] as const).map((value) => <button key={value} data-active={filter === value} type="button" onClick={() => setFilter(value)}>{value === "ALL" ? copy.all : value === "TODAY" ? copy.today : copy.tomorrow}</button>)}
      </div>
      <button className={styles.compactButton} type="button" onClick={() => void refresh()}>{copy.refresh}</button>
    </div>
    {notice ? <p className={styles.success} role="status">{notice}</p> : null}
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <DeliveryTrackingBoard audience="supervisor" locale={locale} />
    <details className={styles.details} open><summary>{copy.createJob}</summary><form className={styles.form} onSubmit={createJob}>
      <div className={styles.formGrid}><label>{copy.approvedRequest}<select name="requestId" required><option value="" disabled>—</option>{workspace?.requests.map((request) => <option key={request.id} value={request.id}>{request.number} · {request.companyName} · {request.branchName} · {request.branchTimezone}</option>)}</select></label><label>{copy.destinationStart}<input name="localStart" type="datetime-local" required /></label><label>{copy.destinationEnd}<input name="localEnd" type="datetime-local" required /></label><label>{copy.instructions}<textarea name="instructions" maxLength={2000} /></label></div>
      <button className={styles.actionButton} data-primary="true" disabled={busy} type="submit">{copy.createJob}</button>
    </form></details>
    <div className={styles.metrics} aria-label={copy.workload}>{workspace?.agents.map((agent) => <div className={styles.metric} key={agent.roleAssignmentId}><UserAvatar name={agent.name} size={40} userId={agent.userId} /><span>{agent.name}</span><strong>{agent.activeJobs}</strong><small>{agent.overdueJobs} {copy.overdue} · {agent.email}</small></div>)}</div>
    {!workspace ? <p className={styles.notice}>{copy.loading}</p> : jobs.length === 0 ? <p className={styles.notice}>{copy.noJobs}</p> : <div className={styles.jobList}>{jobs.map((job) => <article className={styles.job} key={job.id}>
      <header className={styles.jobHeader}><div><p>{job.requestNumber} · {job.companyName} · {job.branchName}</p><h2>{job.code}</h2></div><span className={styles.state}>{deliveryWorkflowStatusLabel(job.status, locale)} · v{job.workflowVersion}</span></header>
      <div className={styles.jobBody}>
        {job.assignment ? <div className={styles.metric}><UserAvatar deliveryJobId={job.id} name={job.assignment.driverName} size={48} userId={job.assignment.driverUserId} /><span>{job.assignment.driverName}</span><small>{deliveryWorkflowStatusLabel(job.assignment.status, locale)}</small></div> : null}
        <dl className={styles.facts}><div className={styles.fact}><dt>{copy.schedule}</dt><dd>{job.scheduledLocalStart?.replace("T", " ")} – {job.scheduledLocalEnd?.slice(11, 16)}<br />{job.destinationTimezone}</dd></div><div className={styles.fact}><dt>{copy.deadline}</dt><dd>{job.acceptanceDeadline ?? "—"}</dd></div><div className={styles.fact}><dt>{copy.sla}</dt><dd>{job.slaDueAt ?? "—"}</dd></div><div className={styles.fact}><dt>{copy.proof}</dt><dd>{job.proofPolicy.join(" + ")} · {job.proofSatisfied ? copy.proofReady : copy.proofMissing}</dd></div></dl>
        <details className={styles.details} open={!job.assignment}><summary>{copy.assign}</summary><form className={styles.form} onSubmit={(event) => assign(event, job)}><div className={styles.formGrid}><label>{copy.agent}<select name="driverRoleAssignmentId" defaultValue={job.assignment?.driverRoleAssignmentId ?? ""} required><option value="" disabled>—</option>{workspace.agents.map((agent) => <option key={agent.roleAssignmentId} value={agent.roleAssignmentId}>{agent.name} · {agent.activeJobs} {copy.active}</option>)}</select></label><label>{copy.note}<input name="reason" minLength={3} maxLength={1000} required /></label><label>{copy.deadline}<input name="acceptanceDeadline" type="datetime-local" defaultValue={localDateTimeInput(job.acceptanceDeadline, job.destinationTimezone)} required /></label><label>{copy.vehicle}<input name="vehicle" maxLength={160} defaultValue={job.assignment?.vehicle} /></label><label>{copy.shift}<input name="shift" maxLength={160} defaultValue={job.assignment?.shift} /></label><label>{copy.zone}<input name="zone" maxLength={160} defaultValue={job.assignment?.zone} /></label></div><fieldset><legend>{copy.proof}</legend>{["PHOTO", "SIGNATURE", "OTP"].map((value) => <label key={value}><input name="proofPolicy" type="checkbox" value={value} defaultChecked={job.proofPolicy.includes(value)} /> {value}</label>)}</fieldset><button className={styles.actionButton} disabled={busy} type="submit">{copy.assign}</button></form></details>
        {!['OUT_FOR_DELIVERY','ARRIVED','PARTIALLY_DELIVERED','DELIVERED','COMPLETED','CANCELLED'].includes(job.status) ? <details className={styles.details}><summary>{copy.cancel}</summary><form className={styles.form} onSubmit={(event) => manage(event, job, "CANCEL")}><label>{copy.note}<input name="reason" minLength={3} maxLength={1000} required /></label><button className={styles.actionButton} disabled={busy} type="submit">{copy.cancel}</button></form></details> : null}
        {!['DELIVERED','COMPLETED','CANCELLED'].includes(job.status) ? <details className={styles.details}><summary>{copy.reschedule}</summary><form className={styles.form} onSubmit={(event) => manage(event, job, "RESCHEDULE")}><div className={styles.formGrid}><label>{copy.note}<input name="reason" minLength={3} maxLength={1000} required /></label><label>{copy.destinationStart}<input name="localStart" type="datetime-local" required /></label><label>{copy.destinationEnd}<input name="localEnd" type="datetime-local" required /></label></div><button className={styles.actionButton} disabled={busy} type="submit">{copy.reschedule}</button></form></details> : null}
        {['DELIVERED','PARTIALLY_DELIVERED'].includes(job.status) && !job.proofSatisfied ? <details className={styles.details}><summary>{copy.exception}</summary><form className={styles.form} onSubmit={(event) => manage(event, job, "PROOF_EXCEPTION")}><label>{copy.note}<input name="reason" minLength={3} maxLength={1000} required /></label><button className={styles.actionButton} disabled={busy} type="submit">{copy.exception}</button></form></details> : null}
        {job.history.length ? <details className={styles.details}><summary>{copy.assignmentHistory}</summary><ol className={styles.timeline}>{job.history.map((item) => <li className={styles.timelineItem} key={item.id}><strong>{item.driverName} · {deliveryWorkflowStatusLabel(item.status, locale)}</strong><span>{item.reason}</span><time>{item.assignedAt}</time></li>)}</ol></details> : null}
      </div>
    </article>)}</div>}
  </section>;
}
