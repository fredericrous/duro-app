export const supportedLngs = ["en", "fr"] as const
export type SupportedLng = (typeof supportedLngs)[number]
export const fallbackLng: SupportedLng = "en"
export const defaultNS = "translation"
