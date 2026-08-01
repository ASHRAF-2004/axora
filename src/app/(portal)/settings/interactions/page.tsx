import { InteractionEditor } from "@/components/interactions";
import { PageHeader } from "@/components/PageHeader";
import { requirePagePermission } from "@/lib/auth";
import { isDemoMode } from "@/lib/db";
import {
  interactionProfileFromCompany,
  recommendInteraction,
} from "@/lib/interactions";
import {
  listCompanyInteractionRevisions,
  loadCompanyInteractionProfile,
} from "@/lib/interactions/repository";
import { listCompanies } from "@/lib/repository";
import { CheckCircle2, Clock3, History, ShieldCheck } from "lucide-react";
import {
  clearInteractionOverrideAction,
  publishInteractionAction,
  regenerateInteractionRecommendationAction,
  rollbackInteractionRevisionFormAction,
  saveInteractionOverrideAction,
} from "./actions";

export const metadata = {
  title: "Interactive experience | Axora",
};

export default async function InteractionsSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ companyId?: string }>;
}) {
  const actor = await requirePagePermission("manage_interactions");
  const companies = await listCompanies(actor);
  const params = await searchParams;
  const requestedCompanyId = actor.isOwner
    ? params.companyId
    : actor.companyId;
  const company = companies.find((candidate) => candidate.id === requestedCompanyId)
    ?? companies[0];

  if (!company) {
    return <>
      <PageHeader
        eyebrow="Website intelligence"
        title="Interactive experience"
        description="Choose a company before configuring its website experience."
      />
      <section className="panel">
        <div className="panel-body">
          <div className="callout">
            <strong>No active company is available.</strong>
            <p>Create or activate a company before generating an interaction recommendation.</p>
          </div>
        </div>
      </section>
    </>;
  }

  const demoMode = isDemoMode();
  const [workspace, revisions] = await Promise.all([
    loadCompanyInteractionProfile(company.id, actor),
    listCompanyInteractionRevisions(company.id, actor),
  ]);
  const recommendation = workspace?.recommendation
    ?? recommendInteraction(interactionProfileFromCompany(company));
  const initialChoice = workspace?.ownerChoice ?? null;
  const initialConfig = initialChoice?.config
    ?? workspace?.publishedConfig
    ?? recommendation.config;

  const saveAction = demoMode
    ? undefined
    : saveInteractionOverrideAction.bind(null, company.id);
  const publishAction = demoMode
    ? undefined
    : publishInteractionAction.bind(null, company.id);
  const clearOverrideAction = demoMode
    ? undefined
    : clearInteractionOverrideAction.bind(null, company.id);
  const regenerateAction = demoMode
    ? undefined
    : regenerateInteractionRecommendationAction.bind(null, company.id);

  return <>
    <PageHeader
      eyebrow="Website intelligence"
      title="Interactive experience"
      description="Review Axora's company-aware recommendation, preview every safety mode, and publish only an owner-approved configuration."
    />

    {actor.isOwner && companies.length > 1 ? (
      <section className="panel interaction-company-switcher">
        <div className="panel-body">
          <form method="get">
            <label htmlFor="interaction-company">
              Company workspace
              <select defaultValue={company.id} id="interaction-company" name="companyId">
                {companies.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name} · {candidate.industry}
                  </option>
                ))}
              </select>
            </label>
            <button className="button button-secondary" type="submit">Open company</button>
          </form>
        </div>
      </section>
    ) : null}

    <section className="interaction-workspace-summary" aria-label="Interaction workspace status">
      <article>
        <ShieldCheck aria-hidden="true" />
        <div><span>Company scope</span><strong>{company.name}</strong></div>
      </article>
      <article>
        <CheckCircle2 aria-hidden="true" />
        <div><span>Owner decision</span><strong>{initialChoice ? initialChoice.decision : "Awaiting review"}</strong></div>
      </article>
      <article>
        <Clock3 aria-hidden="true" />
        <div><span>Published</span><strong>{workspace?.publishedAt ? new Date(workspace.publishedAt).toLocaleDateString("en-MY") : "Not published"}</strong></div>
      </article>
    </section>

    {demoMode ? (
      <div className="callout interaction-demo-notice" role="status">
        <strong>Safe local preview</strong>
        <p>You can test every editor and mascot control. Saving and publishing stay disabled because demonstration data resets on restart.</p>
      </div>
    ) : null}

    <InteractionEditor
      canPublish={!demoMode}
      clearOverrideAction={clearOverrideAction}
      companyName={company.name}
      industry={company.industry}
      initialChoice={initialChoice}
      initialConfig={initialConfig}
      publishAction={publishAction}
      recommendation={recommendation}
      regenerateAction={regenerateAction}
      saveAction={saveAction}
      tagline={`${company.industry} · owner-controlled experience`}
    />

    <section className="panel interaction-revision-panel">
      <div className="panel-header">
        <div>
          <h2><History aria-hidden="true" size={19} /> Publication history</h2>
          <p>Every publish and rollback creates a new immutable revision.</p>
        </div>
      </div>
      <div className="panel-body">
        {revisions.length ? (
          <div className="interaction-revision-list">
            {revisions.map((revision) => (
              <article data-current={revision.isCurrent ? "true" : "false"} key={revision.id}>
                <div>
                  <strong>Version {revision.revisionNumber}</strong>
                  <span>{revision.source === "ROLLBACK" ? "Rollback" : "Published"}</span>
                  <small>{new Date(revision.createdAt).toLocaleString("en-MY", { timeZone: "Asia/Kuala_Lumpur" })}</small>
                </div>
                {revision.isCurrent || demoMode ? (
                  <span className="status-badge status-success">{revision.isCurrent ? "Current" : "Preview"}</span>
                ) : (
                  <form action={rollbackInteractionRevisionFormAction}>
                    <input name="companyId" type="hidden" value={company.id} />
                    <input name="revisionId" type="hidden" value={revision.id} />
                    <button className="button button-secondary" type="submit">Restore as new version</button>
                  </form>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className="callout">
            <strong>No publication history yet.</strong>
            <p>The first approved publish will appear here and remain available for rollback.</p>
          </div>
        )}
      </div>
    </section>
  </>;
}
