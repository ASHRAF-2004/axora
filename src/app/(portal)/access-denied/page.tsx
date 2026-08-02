import { PageHeader } from "@/components/PageHeader";
import { requireSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { ArrowLeft, ShieldX } from "lucide-react";
import Link from "next/link";
import { operationalMessage, type OperationalMessageKey } from "@/lib/operational-i18n";

export default async function AccessDeniedPage() {
  const actor = await requireSession();
  const locale = actor.preferredLocale ?? "en";
  const m = (key: OperationalMessageKey) => operationalMessage(locale, key);
  const destination = canAccess(actor, "view_dashboard")
    ? { href: "/dashboard", label: m("access.dashboard") }
    : canAccess(actor, "manage_settings") || canAccess(actor, "view_system_diagnostics")
      ? { href: "/settings", label: m("access.settings") }
      : { href: "/help", label: m("access.help") };

  return (
    <>
      <PageHeader
        eyebrow={m("access.eyebrow")}
        title={m("access.title")}
        description={m("access.description")}
      />
      <section className="panel empty-state">
        <ShieldX aria-hidden="true" size={38} />
        <strong>{m("access.none")}</strong>
        <p>{m("access.body")}</p>
        <Link className="button button-primary" href={destination.href}>
          <ArrowLeft aria-hidden="true" size={16} />
          {destination.label}
        </Link>
      </section>
    </>
  );
}
