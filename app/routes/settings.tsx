import { redirect, useFetcher } from "react-router"
import { useTranslation } from "react-i18next"
import type { Route } from "./+types/settings"
import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { Effect } from "effect"
import { resolveLocale } from "~/lib/i18n.server"
import { handleSettingsMutation, parseSettingsMutation } from "~/lib/mutations/settings"
import { Alert, Button, Field, Heading, Stack } from "@duro-app/ui"
import { LanguageSelect } from "~/components/LanguageSelect/LanguageSelect"
import { CertificateSection } from "~/components/CertificateSection/CertificateSection"
import styles from "./settings.module.css"

export type SettingsAction = typeof action

export function meta() {
  return [{ title: "Settings - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  const { locale, lastCertRenewal, p12Password, certificates } = await runEffect(
    Effect.gen(function* () {
      const prefs = yield* PreferencesRepo
      const cert = yield* CertManager
      const certRepo = yield* CertificateRepo
      const locale = yield* prefs.getLocale(auth.user!)
      const lastCertRenewal = yield* prefs.getLastCertRenewal(auth.user!)
      const p12Password = lastCertRenewal.renewalId
        ? yield* cert.getP12Password(lastCertRenewal.renewalId).pipe(Effect.catchAll(() => Effect.succeed(null)))
        : null
      const certificates = yield* certRepo.listValid(auth.user!).pipe(Effect.catchAll(() => Effect.succeed([])))
      return { locale, lastCertRenewal, p12Password, certificates }
    }),
  )
  return {
    locale,
    currentLocale: resolveLocale(request),
    email: auth.email,
    lastCertRenewalAt: lastCertRenewal.at?.toISOString() ?? null,
    p12Password,
    certificates,
  }
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  const formData = await request.formData()
  const parsed = parseSettingsMutation(formData as any, auth)
  if ("error" in parsed) return parsed
  const result = await runEffect(handleSettingsMutation(parsed))
  // Handle redirect results from saveLocale
  if (result && typeof result === "object" && "_redirect" in result) {
    return redirect((result as any)._redirect, {
      headers: { "Set-Cookie": (result as any)._cookie },
    })
  }
  return result
}

export default function SettingsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const fetcher = useFetcher<typeof action>()
  const actionData = fetcher.data

  return (
    <main className={styles.page}>
      <Heading level={1}>{t("settings.heading")}</Heading>

      {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}

      <fetcher.Form method="post">
        <input type="hidden" name="intent" value="saveLocale" />
        <Stack gap="lg">
          <Field.Root>
            <Field.Label>{t("settings.languageLabel")}</Field.Label>
            <LanguageSelect defaultValue={loaderData.locale} />
            <Field.Description>{t("settings.languageHint")}</Field.Description>
          </Field.Root>

          <Button type="submit" variant="primary">
            {t("common.save")}
          </Button>
        </Stack>
      </fetcher.Form>

      <CertificateSection
        email={loaderData.email}
        p12Password={loaderData.p12Password}
        lastCertRenewalAt={loaderData.lastCertRenewalAt}
        certificates={loaderData.certificates}
      />
    </main>
  )
}
