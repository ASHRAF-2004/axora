import { redirect } from "next/navigation";
import { requestLocaleDecision } from "@/lib/locale-server";

export default async function Home() {
  const { locale } = await requestLocaleDecision();
  redirect(`/${locale}`);
}
