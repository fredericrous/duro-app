import { createContext, useContext, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { formatDate, formatDateTime, type DisplayPrefs } from "~/lib/datetime"

export interface DisplayPrefsValue {
  timezone: string | null
  timeFormat: string | null
}

// Default = "no preference" → formatters fall back to the runtime/locale
// defaults. Because it's a context default (not a router hook), the formatter
// works anywhere, including components rendered outside the dashboard layout
// (e.g. in unit tests) without throwing.
const DisplayPrefsContext = createContext<DisplayPrefsValue>({ timezone: null, timeFormat: null })
export const DisplayPrefsProvider = DisplayPrefsContext.Provider

/**
 * Format timestamps using the signed-in user's display preferences (timezone +
 * 12/24h clock, provided by the dashboard layout) and the active i18n locale.
 *
 *   const { formatDate, formatDateTime } = useDisplayFormat()
 *   <td>{formatDate(cert.expiresAt)}</td>
 */
export function useDisplayFormat() {
  const { i18n } = useTranslation()
  const { timezone, timeFormat } = useContext(DisplayPrefsContext)

  const prefs: DisplayPrefs = useMemo(
    () => ({ timezone, timeFormat, locale: i18n.language }),
    [timezone, timeFormat, i18n.language],
  )

  return useMemo(
    () => ({
      formatDate: (value: Date | string | number) => formatDate(value, prefs),
      formatDateTime: (value: Date | string | number) => formatDateTime(value, prefs),
    }),
    [prefs],
  )
}
