import { requestLocaleDecision } from "@/lib/locale-server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function TermsPage() {
  const { locale } = await requestLocaleDecision();
  redirect(`/${locale}/terms-and-conditions`);
}
