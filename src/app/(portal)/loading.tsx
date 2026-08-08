import { RouteLoadingScreen } from "@/components/RouteLoadingScreen";
import { requestLocaleDecision } from "@/lib/locale-server";

const sessionChecking = {
  en: "Checking your secure session…",
  ar: "جارٍ التحقق من جلستك الآمنة…",
  ms: "Menyemak sesi selamat anda…",
} as const;

export default async function PortalLoading() {
  const { locale } = await requestLocaleDecision();
  return (
    <RouteLoadingScreen
      locale={locale}
      message={sessionChecking[locale]}
    />
  );
}
