import { requestLocaleDecision } from "@/lib/locale-server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PrivacyPage() {
  const { locale } = await requestLocaleDecision();
  redirect(`/${locale}/privacy`);
}
