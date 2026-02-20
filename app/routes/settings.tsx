import { redirect, useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/settings"
import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import { Effect } from "effect"
import { supportedLngs } from "~/lib/i18n"
import { localeCookieHeader, resolveLocale } from "~/lib/i18n.server"
import { Alert } from "~/components/Alert/Alert"
import { LanguageSelect } from "~/components/LanguageSelect/LanguageSelect"
import styles from "./settings.module.css"
import shared from "./admin.shared.module.css"

export function meta() {
  return [{ title: "Settings - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  const locale = await runEffect(
    Effect.gen(function* () {
      const prefs = yield* PreferencesRepo
      return yield* prefs.getLocale(auth.user!)
    }),
  )
  return { locale, currentLocale: resolveLocale(request) }
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  const formData = await request.formData()
  const locale = formData.get("locale") as string

  if (!(supportedLngs as readonly string[]).includes(locale)) {
    return { error: "Invalid language" }
  }

  await runEffect(
    Effect.gen(function* () {
      const prefs = yield* PreferencesRepo
      yield* prefs.setLocale(auth.user!, locale)
    }),
  )

  return redirect("/settings", {
    headers: { "Set-Cookie": localeCookieHeader(locale) },
  })
}

export default function SettingsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const fetcher = useFetcher<typeof action>()
  const actionData = fetcher.data

  return (
    <main className={styles.page}>
      <h1 className={styles.heading}>{t("settings.heading")}</h1>

      {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}

      <fetcher.Form method="post" className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="locale" className={styles.label}>
            {t("settings.languageLabel")}
          </label>
          <LanguageSelect defaultValue={loaderData.locale} />
          <p className={styles.hint}>{t("settings.languageHint")}</p>
        </div>

        <button type="submit" className={`${shared.btn} ${shared.btnPrimary}`}>
          {t("common.save")}
        </button>
      </fetcher.Form>
    </main>
  )
}
