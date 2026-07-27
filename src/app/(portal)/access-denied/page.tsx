import { PageHeader } from "@/components/PageHeader";
import { requireSession } from "@/lib/auth";
import { canAccess } from "@/lib/permissions";
import { ArrowLeft, ShieldX } from "lucide-react";
import Link from "next/link";

export default async function AccessDeniedPage() {
  const actor = await requireSession();
  const destination = canAccess(actor, "view_dashboard")
    ? { href: "/dashboard", label: "Back to dashboard" }
    : canAccess(actor, "manage_settings")
      ? { href: "/settings", label: "Open settings" }
      : { href: "/help", label: "Open help" };

  return (
    <>
      <PageHeader
        eyebrow="Access control"
        title="This page is not part of your role"
        description="Your account is signed in, but it does not have permission to open that workspace."
      />
      <section className="panel empty-state">
        <ShieldX aria-hidden="true" size={38} />
        <strong>No data was shown</strong>
        <p>
          Use the navigation available to your role. Ask your company administrator if your responsibilities have changed.
        </p>
        <Link className="button button-primary" href={destination.href}>
          <ArrowLeft aria-hidden="true" size={16} />
          {destination.label}
        </Link>
      </section>
    </>
  );
}
