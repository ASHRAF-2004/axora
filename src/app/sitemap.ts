import { PUBLIC_PAGE_SLUGS, SUPPORTED_LOCALES } from "@/lib/i18n";
import type { MetadataRoute } from "next";

const baseUrl = "https://axora.management";

function languageAlternates(path = "") {
  return {
    languages: {
      en: `${baseUrl}/en${path}`,
      ar: `${baseUrl}/ar${path}`,
      ms: `${baseUrl}/ms${path}`,
      "x-default": `${baseUrl}/en${path}`,
    },
  };
}

export default function sitemap(): MetadataRoute.Sitemap {
  const modified = new Date("2026-08-02T00:00:00.000Z");
  return SUPPORTED_LOCALES.flatMap((locale) => [
    { url: `${baseUrl}/${locale}`, lastModified: modified, changeFrequency: "weekly" as const, priority: 1, alternates: languageAlternates() },
    ...PUBLIC_PAGE_SLUGS.map((slug) => ({
      url: `${baseUrl}/${locale}/${slug}`,
      lastModified: modified,
      changeFrequency: "monthly" as const,
      priority: slug === "how-it-works" || slug === "procurement-process" ? .8 : .6,
      alternates: languageAlternates(`/${slug}`),
    })),
    { url: `${baseUrl}/${locale}/contact`, lastModified: modified, changeFrequency: "monthly" as const, priority: .8, alternates: languageAlternates("/contact") },
  ]);
}
