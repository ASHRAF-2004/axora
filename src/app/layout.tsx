import type { Metadata } from "next";
import { UxFeedbackProvider } from "@/components/UxFeedbackProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Axora operations", template: "%s | Axora operations" },
  description: "Secure multi-company procurement and operations management with Axora.",
  icons: {
    icon: [
      { url: "/brand/axora-mark.svg", type: "image/svg+xml" },
      { url: "/brand/axora-icon-32.png", sizes: "32x32", type: "image/png" },
    ],
    shortcut: "/brand/axora-icon-32.png",
    apple: [
      { url: "/brand/axora-apple-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <UxFeedbackProvider>{children}</UxFeedbackProvider>
      </body>
    </html>
  );
}
