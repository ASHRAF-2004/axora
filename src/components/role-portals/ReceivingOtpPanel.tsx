"use client";

import { useCallback, useEffect, useState } from "react";
import { deliveryWorkflowMessages, deliveryWorkflowStatusLabel, type DeliveryWorkflowLocale } from "@/lib/delivery-workflow-i18n";
import { DeliveryTrackingBoard } from "./DeliveryTrackingPanels";
import styles from "./DeliveryExecution.module.css";

type Job = {
  id: string; code: string; status: string; requestNumber: string;
  branchName: string; destinationTimezone: string; scheduledLocalStart?: string;
  proofPolicy: string[];
};
type Issued = { challengeId: string; expiresAt: string; recipientIdentity: string; code: string };

export function ReceivingOtpPanel({ locale = "en" }: { locale?: DeliveryWorkflowLocale }) {
  const copy = deliveryWorkflowMessages(locale);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    const response = await fetch("/api/receiving/delivery-otp", { cache: "no-store" });
    if (!response.ok) throw new Error("workspace");
    setJobs(((await response.json()) as { jobs: Job[] }).jobs);
    setLoaded(true);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refresh().catch(() => setError(copy.workspaceUnavailable));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [copy.workspaceUnavailable, refresh]);
  const issue = async (jobId: string) => {
    setIssued(null); setError("");
    try {
      const response = await fetch("/api/receiving/delivery-otp", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      if (!response.ok) throw new Error("confirmation");
      setIssued(await response.json() as Issued);
    } catch { setError(copy.workspaceUnavailable); }
  };
  return <section className={styles.shell} aria-label={copy.receiverTitle}>
    <div className={styles.toolbar}><div><span className={styles.eyebrow}>P1-10</span><strong>{copy.receiverTitle}</strong><p>{copy.receiverIntro}</p></div></div>
    <DeliveryTrackingBoard audience="company" locale={locale} />
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    {issued ? <div className={styles.otpReveal} role="status"><div><strong>{issued.recipientIdentity}</strong><p>{copy.oneTimeWarning}</p><small>{issued.challengeId} · {issued.expiresAt}</small></div><code>{issued.code}</code></div> : null}
    {!loaded ? <p className={styles.notice}>{copy.loading}</p> : jobs.every((job) => !job.proofPolicy.includes("OTP")) ? <p className={styles.notice}>{copy.noOtpJobs}</p> : <div className={styles.jobList}>{jobs.filter((job) => job.proofPolicy.includes("OTP")).map((job) => <article className={styles.job} key={job.id}><header className={styles.jobHeader}><div><p>{job.requestNumber} · {job.branchName}</p><h2>{job.code}</h2></div><span className={styles.state}>{deliveryWorkflowStatusLabel(job.status, locale)}</span></header><div className={styles.jobBody}><p>{job.scheduledLocalStart?.replace("T", " ")} · {job.destinationTimezone}</p><button className={styles.actionButton} data-primary="true" type="button" onClick={() => void issue(job.id)}>{copy.generateCode}</button></div></article>)}</div>}
  </section>;
}
