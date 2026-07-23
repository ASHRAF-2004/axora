import Link from "next/link";

export function PageHeader({ eyebrow, title, description, actionHref, actionLabel }: { eyebrow?: string; title: string; description: string; actionHref?: string; actionLabel?: string }) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actionHref && actionLabel ? <Link className="button button-primary" href={actionHref}>{actionLabel}</Link> : null}
    </header>
  );
}
