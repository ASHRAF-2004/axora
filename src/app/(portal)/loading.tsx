import { RouteLoadingScreen } from "@/components/RouteLoadingScreen";
import { requestLocaleDecision } from "@/lib/locale-server";

export default async function PortalLoading() {
  const { locale } = await requestLocaleDecision();
  return <RouteLoadingScreen locale={locale} />;
}
