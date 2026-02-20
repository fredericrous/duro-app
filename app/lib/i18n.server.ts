import i18next from "i18next"
import { initReactI18next } from "react-i18next"
import acceptLanguageParser from "accept-language-parser"
import { supportedLngs, fallbackLng, defaultNS } from "./i18n"
import en from "~/locales/en/translation.json"
import fr from "~/locales/fr/translation.json"

const COOKIE_NAME = "__duro_locale"

export function resolveLocale(request: Request): string {
  const cookies = request.headers.get("Cookie") ?? ""
  const match = cookies.match(new RegExp(`${COOKIE_NAME}=([^;]+)`))
  if (match && (supportedLngs as readonly string[]).includes(match[1])) {
    return match[1]
  }

  const header = request.headers.get("Accept-Language") ?? ""
  return acceptLanguageParser.pick([...supportedLngs], header) ?? fallbackLng
}

export function localeCookieHeader(locale: string): string {
  return `${COOKIE_NAME}=${locale}; Path=/; SameSite=Lax; HttpOnly; Max-Age=31536000`
}

export async function createI18nInstance(lng: string) {
  const instance = i18next.createInstance()
  await instance.use(initReactI18next).init({
    lng,
    supportedLngs: [...supportedLngs],
    fallbackLng,
    defaultNS,
    resources: { en: { translation: en }, fr: { translation: fr } },
    interpolation: { escapeValue: false },
  })
  return instance
}
