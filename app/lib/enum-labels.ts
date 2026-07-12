type TFunc = (key: string, opts?: Record<string, unknown>) => string

/** Turn a raw enum token into a readable fallback: `invite_only` → "Invite only",
 *  `grant.created` → "Grant created". Used when no explicit i18n key exists. */
export function humanizeEnum(value: string): string {
  const spaced = value.replace(/[_.]+/g, " ").trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/**
 * Human label for an enum value. Prefers an explicit i18n key
 * (`common.enums.<category>.<value>`); falls back to a humanized token so
 * open-ended enums (audit event types, plugin actions) still read cleanly and
 * nothing renders as a raw `snake_case`/`dotted.token`.
 */
export function enumLabel(t: TFunc, category: string, value: string | null | undefined): string {
  if (!value) return "—"
  return t(`common.enums.${category}.${value}`, { defaultValue: humanizeEnum(value) })
}
