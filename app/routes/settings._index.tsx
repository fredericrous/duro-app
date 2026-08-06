import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Form, redirect, useFetcher, useSearchParams } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/settings._index"
import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import { resolveLocale } from "~/lib/i18n.server"
import { resolveThemePreference } from "~/lib/theme.server"
import { parseSettingsMutation, handleSettingsMutation } from "~/lib/mutations/settings"
import { Alert, Field, Select, Stack } from "@duro-app/ui"
import { CardSection } from "~/components/CardSection/CardSection"
import { LanguageSelect } from "~/components/LanguageSelect/LanguageSelect"
import { formatDateTime, prefToSelect, selectToPref, TIMEZONE_OPTIONS, TIME_FORMAT_OPTIONS } from "~/lib/datetime"

export function meta() {
  return [{ title: "General - Duro settings" }]
}

// A fixed, representative instant for the format preview — deterministic so it
// renders identically on the server and client (a live clock would mismatch on
// hydration). Afternoon so 12h vs 24h is unambiguous.
const PREVIEW_SAMPLE = new Date("2026-01-15T14:30:00Z")

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  const { locale, timezone, timeFormat } = await runEffect(
    Effect.gen(function* () {
      const prefs = yield* PreferencesRepo
      const locale = yield* prefs.getLocale(auth.user!)
      const display = yield* prefs.getDisplayPrefs(auth.user!)
      return { locale, timezone: display.timezone, timeFormat: display.timeFormat }
    }),
  )
  return { locale, timezone, timeFormat, currentLocale: resolveLocale(request), theme: resolveThemePreference(request) }
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  const formData = await request.formData()
  const parsed = parseSettingsMutation(formData as unknown as FormData, auth)
  if ("error" in parsed) return parsed

  const result = await runEffect(handleSettingsMutation(parsed).pipe(Effect.orDie))
  // saveLocale and saveTheme return a redirect marker (they must set their
  // cookie and reload so the new language/theme is what the server paints).
  // The reload discards any client-side toast, so carry the acknowledgement
  // across it in the URL — see the ?saved handling in the component.
  if (result && typeof result === "object" && "_redirect" in result) {
    const to = (result as { _redirect: string })._redirect
    return redirect(`${to}?saved=1`, {
      headers: { "Set-Cookie": (result as { _cookie: string })._cookie },
    })
  }
  return result
}

export default function GeneralSettings({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const localeFormRef = useRef<HTMLFormElement>(null)
  const displayFetcher = useFetcher<typeof action>()
  const themeFetcher = useFetcher<typeof action>()
  const [searchParams] = useSearchParams()

  const [tz, setTz] = useState(prefToSelect(loaderData.timezone))
  const [tf, setTf] = useState(prefToSelect(loaderData.timeFormat))

  // One acknowledgement for the whole page, rendered from state rather than
  // fired imperatively. It has to cover two different routes to the same
  // outcome: display prefs settle in place on a fetcher, while language and
  // theme reload the document (their cookie decides what the server renders),
  // and a toast queued before that navigation never survives it — the action
  // redirects with ?saved=1 so the acknowledgement outlives the reload.
  const displayError = displayFetcher.data && "error" in displayFetcher.data ? String(displayFetcher.data.error) : null
  const justSaved =
    searchParams.has("saved") || Boolean(displayFetcher.data && "displayPrefsSaved" in displayFetcher.data)

  // Submitting straight from the select's change handler posts the PREVIOUS
  // locale: the DS select updates its own form value through React state, which
  // has not reached the DOM yet when the handler runs. Record the choice, let
  // React commit, then submit.
  const [pendingLocale, setPendingLocale] = useState<string | null>(null)
  useEffect(() => {
    if (pendingLocale) localeFormRef.current?.requestSubmit()
  }, [pendingLocale])

  const saveDisplay = (nextTz: string, nextTf: string) => {
    displayFetcher.submit({ intent: "saveDisplayPrefs", timezone: nextTz, timeFormat: nextTf }, { method: "post" })
  }

  return (
    <Stack gap="lg">
      {displayError && <Alert variant="error">{displayError}</Alert>}
      {!displayError && justSaved && <Alert variant="success">{t("settings.saved")}</Alert>}

      <CardSection title={t("settings.languageLabel")}>
        {/* `reloadDocument` makes this a plain browser form POST rather than a
            client-routed one. Locale lives in a cookie that decides what the
            SERVER renders, so the new language only takes effect on a real
            document load: a client navigation re-runs loaders but leaves the
            already-initialised i18next instance — and the selects' latched
            labels — on the old language. */}
        <Form method="post" reloadDocument ref={localeFormRef}>
          <input type="hidden" name="intent" value="saveLocale" />
          <Stack gap="lg">
            <Field.Root>
              <LanguageSelect
                defaultValue={loaderData.locale}
                onValueChange={(v) => {
                  if (!v || v === loaderData.locale) return
                  setPendingLocale(v)
                }}
              />
              <Field.Description>{t("settings.languageHint")}</Field.Description>
            </Field.Root>
          </Stack>
        </Form>
      </CardSection>

      <CardSection title={t("settings.theme.heading")}>
        <Stack gap="lg">
          <Field.Root>
            <Field.Label>{t("settings.theme.label")}</Field.Label>
            <Select.Root
              name="theme"
              defaultValue={loaderData.theme}
              onValueChange={(v) => {
                if (!v || v === loaderData.theme) return
                themeFetcher.submit({ intent: "saveTheme", theme: v }, { method: "post" })
              }}
              initialLabels={{
                dark: t("settings.theme.dark"),
                light: t("settings.theme.light"),
                system: t("settings.theme.system"),
              }}
            >
              <Select.Trigger>
                <Select.Value placeholder={t("settings.theme.label")} />
                <Select.Icon />
              </Select.Trigger>
              <Select.Popup>
                <Select.Item value="system">
                  <Select.ItemText>{t("settings.theme.system")}</Select.ItemText>
                </Select.Item>
                <Select.Item value="dark">
                  <Select.ItemText>{t("settings.theme.dark")}</Select.ItemText>
                </Select.Item>
                <Select.Item value="light">
                  <Select.ItemText>{t("settings.theme.light")}</Select.ItemText>
                </Select.Item>
              </Select.Popup>
            </Select.Root>
            <Field.Description>{t("settings.theme.hint")}</Field.Description>
          </Field.Root>
        </Stack>
      </CardSection>

      <CardSection title={t("settings.display.heading")}>
        <Stack gap="lg">
          <Field.Root>
            <Field.Label>{t("settings.display.timezoneLabel")}</Field.Label>
            <Select.Root
              value={tz}
              onValueChange={(v) => {
                const next = v ?? "auto"
                if (next === tz) return
                setTz(next)
                saveDisplay(next, tf)
              }}
            >
              <Select.Trigger>
                <Select.Value placeholder={t("settings.display.timezoneLabel")} />
                <Select.Icon />
              </Select.Trigger>
              <Select.Popup>
                {TIMEZONE_OPTIONS.map((o) => (
                  <Select.Item key={o.value} value={o.value}>
                    <Select.ItemText>
                      {o.value === "auto" ? t("settings.display.timezoneAuto") : o.label}
                    </Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Root>
          </Field.Root>

          <Field.Root>
            <Field.Label>{t("settings.display.timeFormatLabel")}</Field.Label>
            <Select.Root
              value={tf}
              onValueChange={(v) => {
                const next = v ?? "auto"
                if (next === tf) return
                setTf(next)
                saveDisplay(tz, next)
              }}
            >
              <Select.Trigger>
                <Select.Value placeholder={t("settings.display.timeFormatLabel")} />
                <Select.Icon />
              </Select.Trigger>
              <Select.Popup>
                {TIME_FORMAT_OPTIONS.map((o) => (
                  <Select.Item key={o.value} value={o.value}>
                    <Select.ItemText>{t(`settings.display.timeFormat.${o.value}`)}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.Popup>
            </Select.Root>
            <Field.Description>
              {t("settings.display.preview")}:{" "}
              {formatDateTime(PREVIEW_SAMPLE, {
                timezone: selectToPref(tz),
                timeFormat: selectToPref(tf),
                locale: loaderData.currentLocale,
              })}
            </Field.Description>
          </Field.Root>
        </Stack>
      </CardSection>
    </Stack>
  )
}
