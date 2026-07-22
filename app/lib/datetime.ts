/**
 * User-facing timestamp formatting driven by per-user display preferences
 * (IANA timezone + 12h/24h clock). Both fall back to the runtime default when
 * unset — `timezone` null → the browser/server timezone, `timeFormat` null →
 * the locale's own clock convention. Pure + SSR-safe (Intl only).
 */

export type TimeFormat = "12" | "24"

export interface DisplayPrefs {
  timezone?: string | null
  timeFormat?: string | null
  locale?: string | null
}

function baseOptions(prefs: DisplayPrefs): Intl.DateTimeFormatOptions {
  const opts: Intl.DateTimeFormatOptions = {}
  if (prefs.timezone) opts.timeZone = prefs.timezone
  if (prefs.timeFormat === "12") opts.hour12 = true
  else if (prefs.timeFormat === "24") opts.hour12 = false
  return opts
}

function toDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Date + time, e.g. "14 Jul 2026, 09:32". Empty string for invalid input. */
export function formatDateTime(value: Date | string | number, prefs: DisplayPrefs = {}): string {
  const date = toDate(value)
  if (!date) return ""
  try {
    return new Intl.DateTimeFormat(prefs.locale || undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      ...baseOptions(prefs),
    }).format(date)
  } catch {
    return date.toISOString()
  }
}

/** Date only, e.g. "14 Jul 2026". Empty string for invalid input. */
export function formatDate(value: Date | string | number, prefs: DisplayPrefs = {}): string {
  const date = toDate(value)
  if (!date) return ""
  try {
    return new Intl.DateTimeFormat(prefs.locale || undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      // date-only: drop the clock, keep the timezone so the calendar day is right
      ...(prefs.timezone ? { timeZone: prefs.timezone } : {}),
    }).format(date)
  } catch {
    return date.toISOString().slice(0, 10)
  }
}

/** Sentinel stored as NULL — "follow the device / locale". */
export const AUTO = "auto"

/** Curated timezone list for the settings picker (Auto + common zones). The
 * value "auto" maps to a stored NULL. Kept short on purpose; extend on request. */
export const TIMEZONE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: AUTO, label: "Automatic (your device)" },
  { value: "UTC", label: "UTC" },
  { value: "Europe/Paris", label: "Europe/Paris" },
  { value: "Europe/London", label: "Europe/London" },
  { value: "Europe/Berlin", label: "Europe/Berlin" },
  { value: "Europe/Madrid", label: "Europe/Madrid" },
  { value: "America/New_York", label: "America/New York" },
  { value: "America/Chicago", label: "America/Chicago" },
  { value: "America/Denver", label: "America/Denver" },
  { value: "America/Los_Angeles", label: "America/Los Angeles" },
  { value: "America/Sao_Paulo", label: "America/São Paulo" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo" },
  { value: "Asia/Shanghai", label: "Asia/Shanghai" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata" },
  { value: "Asia/Dubai", label: "Asia/Dubai" },
  { value: "Australia/Sydney", label: "Australia/Sydney" },
]

/** Clock-format options; "auto" maps to a stored NULL (locale default). */
export const TIME_FORMAT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: AUTO, label: "Automatic (locale default)" },
  { value: "24", label: "24-hour" },
  { value: "12", label: "12-hour" },
]

/** Map a stored pref value (may be null) to a select value (never null). */
export const prefToSelect = (v: string | null | undefined): string => v ?? AUTO
/** Map a select value back to what we persist (AUTO → null). */
export const selectToPref = (v: string): string | null => (v === AUTO ? null : v)
