import type { Metadata } from "next";
import { UxFeedbackProvider } from "@/components/UxFeedbackProvider";
import { isSupportedLocale, LOCALE_NAMES } from "@/lib/i18n";
import { requestLocaleDecision } from "@/lib/locale-server";
import { headers } from "next/headers";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://axora.management"),
  title: { default: "Axora procurement", template: "%s | Axora" },
  description: "Secure multi-company procurement and operations management with Axora.",
  icons: {
    icon: [
      { url: "/brand/axora-icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/axora-icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: "/brand/axora-icon-32.png",
    apple: [
      { url: "/brand/axora-apple-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
  manifest: "/manifest.webmanifest",
  robots: { index: true, follow: true },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const routeLocale = (await headers()).get("x-axora-route-locale");
  const locale = isSupportedLocale(routeLocale)
    ? routeLocale
    : (await requestLocaleDecision()).locale;
  return (
    <html lang={locale} dir={LOCALE_NAMES[locale].dir}>
      <body>
        <UxFeedbackProvider>{children}</UxFeedbackProvider>
      </body>
    </html>
  );
}
