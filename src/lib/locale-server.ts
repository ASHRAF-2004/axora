import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  isSupportedLocale,
  LOCALE_COOKIE,
  nearestSupportedLocale,
  parseAcceptLanguage,
  type SupportedLocale,
} from "./i18n";

export interface LocaleDecision {
  locale: SupportedLocale;
  explicit: boolean;
}

export async function requestLocaleDecision(): Promise<LocaleDecision> {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  if (isSupportedLocale(cookieLocale)) return { locale: cookieLocale, explicit: true };
  const acceptLanguage = (await headers()).get("accept-language");
  return {
    locale: nearestSupportedLocale(parseAcceptLanguage(acceptLanguage)),
    explicit: false,
  };
}

export function safeRouteLocale(value: string | undefined): SupportedLocale {
  return isSupportedLocale(value) ? value : DEFAULT_LOCALE;
}
