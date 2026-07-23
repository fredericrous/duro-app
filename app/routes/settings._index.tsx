import { useState } from "react"
import { useTranslation } from "react-i18next"
import { redirect, useFetcher } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/settings._index"
import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import { resolveLocale } from "~/lib/i18n.server"
import { resolveTheme } from "~/lib/theme.server"
import { parseSettingsMutation, handleSettingsMutation } from "~/lib/mutations/settings"
import { Alert, Button, Field, Select, Stack, Text } from "@duro-app/ui"
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
  return { locale, timezone, timeFormat, currentLocale: resolveLocale(request), theme: resolveTheme(request) }
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  const formData = await request.formData()
  const parsed = parseSettingsMutation(formData as unknown as FormData, auth)
  if ("error" in parsed) return parsed

  const result = await runEffect(handleSettingsMutation(parsed))
  // saveLocale returns a redirect marker (it must set the locale cookie and
  // reload so the new language takes effect); convert it to a real redirect.
  if (result && typeof result === "object" && "_redirect" in result) {
    return redirect((result as { _redirect: string })._redirect, {
      headers: { "Set-Cookie": (result as { _cookie: string })._cookie },
    })
  }
  return result
}

export default function GeneralSettings({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const localeFetcher = useFetcher<typeof action>()
  const displayFetcher = useFetcher<typeof action>()
  const themeFetcher = useFetcher<typeof action>()

  const [tz, setTz] = useState(prefToSelect(loaderData.timezone))
  const [tf, setTf] = useState(prefToSelect(loaderData.timeFormat))

  const displaySaved = displayFetcher.data && "displayPrefsSaved" in displayFetcher.data
  const displayError = displayFetcher.data && "error" in displayFetcher.data ? displayFetcher.data.error : null

  return (
    <Stack gap="lg">
      <CardSection title={t("settings.languageLabel")}>
        <localeFetcher.Form method="post">
          <input type="hidden" name="intent" value="saveLocale" />
          <Stack gap="lg">
            <Field.Root>
              <LanguageSelect defaultValue={loaderData.locale} />
              <Field.Description>{t("settings.languageHint")}</Field.Description>
            </Field.Root>
            <Button type="submit" variant="primary">
              {t("common.save")}
            </Button>
          </Stack>
        </localeFetcher.Form>
      </CardSection>

      <CardSection title={t("settings.theme.heading")}>
        <themeFetcher.Form method="post">
          <input type="hidden" name="intent" value="saveTheme" />
          <Stack gap="lg">
            <Field.Root>
              <Field.Label>{t("settings.theme.label")}</Field.Label>
              <Select.Root name="theme" defaultValue={loaderData.theme}>
                <Select.Trigger>
                  <Select.Value placeholder={t("settings.theme.label")} />
                  <Select.Icon />
                </Select.Trigger>
                <Select.Popup>
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
            <Button type="submit" variant="primary">
              {t("common.save")}
            </Button>
          </Stack>
        </themeFetcher.Form>
      </CardSection>

      <CardSection title={t("settings.display.heading")}>
        <displayFetcher.Form method="post">
          <input type="hidden" name="intent" value="saveDisplayPrefs" />
          <input type="hidden" name="timezone" value={tz} />
          <input type="hidden" name="timeFormat" value={tf} />
          <Stack gap="lg">
            {displaySaved && <Alert variant="success">{t("settings.display.saved")}</Alert>}
            {displayError && <Alert variant="error">{displayError}</Alert>}

            <Field.Root>
              <Field.Label>{t("settings.display.timezoneLabel")}</Field.Label>
              <Select.Root value={tz} onValueChange={(v) => setTz(v ?? "auto")}>
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
              <Select.Root value={tf} onValueChange={(v) => setTf(v ?? "auto")}>
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

            <Button type="submit" variant="primary">
              {t("common.save")}
            </Button>
          </Stack>
        </displayFetcher.Form>
      </CardSection>
    </Stack>
  )
}
