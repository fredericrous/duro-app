import i18next from "i18next"
import { initReactI18next } from "react-i18next"
import { supportedLngs, fallbackLng, defaultNS } from "./i18n"
import en from "~/locales/en/translation.json"
import fr from "~/locales/fr/translation.json"

if (!i18next.isInitialized) {
  i18next.use(initReactI18next).init({
    lng: fallbackLng,
    supportedLngs: [...supportedLngs],
    fallbackLng,
    defaultNS,
    resources: { en: { translation: en }, fr: { translation: fr } },
    interpolation: { escapeValue: false },
    initImmediate: false,
  })
}
