import { LOCALE_NAMES } from "@/lib/i18n";
import { requestLocaleDecision } from "@/lib/locale-server";
import { notificationCentreMessages } from "@/lib/notification-centre-i18n";
import { BellRing } from "lucide-react";

export default async function NotificationsLoading() {
  const { locale } = await requestLocaleDecision();
  const copy = notificationCentreMessages(locale);
  return <div className="notification-loading" role="status" lang={locale} dir={LOCALE_NAMES[locale].dir}>
    <BellRing size={24} aria-hidden="true" /><span>{copy.loading}</span>
  </div>;
}
