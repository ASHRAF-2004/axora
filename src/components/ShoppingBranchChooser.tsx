import { MapPin, ShoppingBag, TriangleAlert } from "lucide-react";
import Link from "next/link";

import { selectShoppingBranchAction } from "@/app/(portal)/products/actions";
import type { SupportedLocale } from "@/lib/i18n";
import type { ShoppingBranchContext } from "@/lib/shopping-context";
import { shoppingContextMessages } from "@/lib/shopping-context-i18n";

export function ShoppingBranchChooser({
  branches,
  locale,
  invalidSelection = false,
}: {
  branches: readonly ShoppingBranchContext[];
  locale: SupportedLocale;
  invalidSelection?: boolean;
}) {
  const copy = shoppingContextMessages(locale);
  const ready = branches.filter((branch) => branch.ready);
  return (
    <section className="shopping-branch-chooser" aria-labelledby="shopping-branch-title">
      {invalidSelection ? (
        <div className="request-section-error" role="alert">
          <TriangleAlert size={18} aria-hidden="true" />{copy.invalidBranch}
        </div>
      ) : null}
      <div className="shopping-branch-chooser-heading">
        <ShoppingBag size={25} aria-hidden="true" />
        <div>
          <h2 id="shopping-branch-title">{copy.chooserHeading}</h2>
          <p>{copy.chooserBody}</p>
        </div>
      </div>
      <p className="shopping-branch-isolation-note">{copy.separateCarts}</p>
      {branches.length ? (
        <div className="shopping-branch-grid">
          {branches.map((branch) => branch.ready ? (
            <form action={selectShoppingBranchAction} key={branch.id}>
              <input type="hidden" name="branchId" value={branch.id} />
              <button className="shopping-branch-card" type="submit" aria-label={copy.select(branch.name)}>
                <span className="shopping-branch-card-icon"><MapPin size={20} aria-hidden="true" /></span>
                <span className="shopping-branch-card-copy">
                  <strong>{branch.code} · {branch.name}</strong>
                  <span>{branch.city}</span>
                  <small>{branch.address}</small>
                </span>
              </button>
            </form>
          ) : (
            <article className="shopping-branch-card is-unready" key={branch.id}>
              <span className="shopping-branch-card-icon"><MapPin size={20} aria-hidden="true" /></span>
              <span className="shopping-branch-card-copy">
                <strong>{branch.code} · {branch.name}</strong>
                <span>{branch.city}</span>
                <small>{copy.locationRequired}</small>
                {branch.canManageLocation ? (
                  <Link href={`/branches/${encodeURIComponent(branch.id)}/delivery-location`}>{copy.setLocation}</Link>
                ) : null}
              </span>
            </article>
          ))}
        </div>
      ) : null}
      {!ready.length ? (
        <div className="shopping-branch-empty">
          <strong>{copy.unavailableTitle}</strong>
          <p>{copy.unavailableBody}</p>
          <Link className="button button-primary" href="/branches">{copy.manageBranches}</Link>
        </div>
      ) : null}
    </section>
  );
}
