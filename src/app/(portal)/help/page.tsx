import { PageHeader } from "@/components/PageHeader";
import { requireAccountLifecycleSession } from "@/lib/auth";
import { listTutorialProgress } from "@/lib/onboarding";
import {
  BookOpenCheck,
  Building2,
  ClipboardCheck,
  ClipboardPlus,
  Download,
  ImageUp,
  PackageSearch,
  ShieldCheck,
  Truck,
  UserRoundCog,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { operationalHelpContent, operationalMessage, operationalNumber, type OperationalMessageKey } from "@/lib/operational-i18n";

export default async function HelpPage() {
  const actor = await requireAccountLifecycleSession();
  const locale = actor.preferredLocale ?? "en";
  const m = (key: OperationalMessageKey, values?: Record<string, string | number>) => operationalMessage(locale, key, values);
  const content = operationalHelpContent(locale);
  const tutorial = await listTutorialProgress(actor);
  const settled = tutorial.filter((step) => step.status === "COMPLETED" || step.status === "SKIPPED").length;
  const tutorialPanel = <section className="tutorial-summary" data-tour="help">
    <div><span className="tutorial-summary-icon"><BookOpenCheck size={22} /></span><div><p className="eyebrow">{m("help.roleGuide")}</p><h2>{m(settled === tutorial.length ? "help.complete" : "help.continue")}</h2><p>{m("help.progress", { settled: operationalNumber(locale, settled), total: operationalNumber(locale, tutorial.length) })}</p></div></div>
    <div className="tutorial-summary-progress" aria-label={m("help.progressLabel", { settled: operationalNumber(locale, settled), total: operationalNumber(locale, tutorial.length) })}><span style={{ width: `${tutorial.length ? settled / tutorial.length * 100 : 0}%` }} /></div>
    <Link className="button button-primary" href="/help?tutorial=1">{m(settled === tutorial.length ? "help.review" : "help.continueButton")}</Link>
  </section>;

  if (actor.isOwner) {
    const ownerIcons = [Building2, PackageSearch, ImageUp, ClipboardCheck, Truck];
    return <><PageHeader eyebrow={m("help.ownerEyebrow")} title={m("help.ownerTitle")} description={m("help.ownerDescription")} />
      {tutorialPanel}
      <section className="panel" style={{ marginBottom: 17 }}>
        <div className="panel-header"><div><h2>{m("help.ownerManuals")}</h2><p>{m("help.manualsIntro")}</p></div>
          <div className="toolbar-group">
            <a className="button button-secondary" href="/manuals/axora-owner-admin-manual-en.pdf" target="_blank" rel="noreferrer"><Download size={16} /> {m("help.englishPdf")}</a>
            <a className="button button-secondary" href="/manuals/axora-owner-admin-manual-ar.pdf" target="_blank" rel="noreferrer"><Download size={16} /> {m("help.arabicPdf")}</a>
          </div>
        </div>
      </section>
      <section className="dashboard-grid">
        <article className="panel"><div className="panel-header"><div><h2>{m("help.ownerWorkflow")}</h2><p>{m("help.ownerWorkflowIntro")}</p></div></div><div className="panel-body readiness-list">
          {content.ownerSteps.map((item, index) => { const Icon = ownerIcons[index]; return <div className="readiness-item" key={item.title}><Icon /><div><strong>{item.title}</strong><p>{item.body}</p></div></div>; })}
        </div></article>
        <article className="panel"><div className="panel-header"><div><h2>{m("help.ownerRules")}</h2><p>{m("help.ownerRulesIntro")}</p></div></div><div className="panel-body readiness-list">
          {content.ownerRules.map((item, index) => { const Icon = [ShieldCheck, BookOpenCheck, ImageUp][index]; return <div className="readiness-item" key={item.title}><Icon /><div><strong>{item.title}</strong><p>{item.body}</p></div></div>; })}
        </div></article>
      </section>
    </>;
  }

  const companyIcons = [Building2, UserRoundCog, PackageSearch, ClipboardPlus, ClipboardCheck, Truck];
  return <><PageHeader eyebrow={m("help.companyEyebrow")} title={m("help.companyTitle")} description={m("help.companyDescription")} />
    {tutorialPanel}
    <section className="panel" style={{ marginBottom: 17 }}>
      <div className="panel-header"><div><h2>{m("help.companyManuals")}</h2><p>{m("help.manualsIntro")}</p></div>
        <div className="toolbar-group">
          <a className="button button-secondary" href="/manuals/axora-company-user-manual-en.pdf" target="_blank" rel="noreferrer"><Download size={16} /> {m("help.englishPdf")}</a>
          <a className="button button-secondary" href="/manuals/axora-company-user-manual-ar.pdf" target="_blank" rel="noreferrer"><Download size={16} /> {m("help.arabicPdf")}</a>
        </div>
      </div>
    </section>
    <section className="dashboard-grid">
      <article className="panel"><div className="panel-header"><div><h2>{m("help.companyWorkflow")}</h2><p>{m("help.companyWorkflowIntro")}</p></div></div><div className="panel-body readiness-list">
        {content.companySteps.map((item, index) => { const Icon = companyIcons[index]; return <div className="readiness-item" key={item.title}><Icon /><div><strong>{item.title}</strong><p>{item.body}</p></div></div>; })}
      </div></article>
      <article className="panel"><div className="panel-header"><div><h2>{m("help.companyRules")}</h2><p>{m("help.companyRulesIntro")}</p></div></div><div className="panel-body readiness-list">
        {content.companyRules.map((item, index) => { const Icon = [WalletCards, ShieldCheck, BookOpenCheck][index]; return <div className="readiness-item" key={item.title}><Icon /><div><strong>{item.title}</strong><p>{item.body}</p></div></div>; })}
      </div></article>
    </section>
  </>;
}
