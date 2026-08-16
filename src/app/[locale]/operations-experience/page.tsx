import { AxoraImmersiveExperience } from "@/components/public/AxoraImmersiveExperience";
import { isSupportedLocale, type SupportedLocale } from "@/lib/i18n";
import type { PublicSceneRoute } from "@/lib/immersive-public-experience";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

const sceneRoutes = new Set<PublicSceneRoute>([
  "home",
  "how-it-works",
  "procurement-process",
  "solutions-by-role",
  "security-and-privacy",
  "about",
]);

const metadataByLocale = {
  en: { title: "Operations Experience", description: "Explore Axora's procurement workflow through an optional interactive experience." },
  ar: { title: "تجربة العمليات", description: "استكشف مسار المشتريات في أكسورا من خلال تجربة تفاعلية اختيارية." },
  ms: { title: "Pengalaman Operasi", description: "Terokai aliran perolehan Axora melalui pengalaman interaktif pilihan." },
} as const;

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const safeLocale = isSupportedLocale(locale) ? locale : "en";
  return metadataByLocale[safeLocale];
}

export default async function OperationsExperiencePage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ scene?: string }>;
}) {
  const [{ locale: rawLocale }, query] = await Promise.all([params, searchParams]);
  if (!isSupportedLocale(rawLocale)) notFound();
  const locale = rawLocale as SupportedLocale;
  const route = sceneRoutes.has(query.scene as PublicSceneRoute)
    ? query.scene as PublicSceneRoute
    : "home";
  return <AxoraImmersiveExperience locale={locale} route={route} />;
}
