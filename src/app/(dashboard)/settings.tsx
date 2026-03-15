import { useTranslation } from "react-i18next"
import { useLoaderData } from "expo-router"
import type { LoaderFunction } from "expo-server"
import { Effect } from "effect"
import { useAction } from "~/hooks/useAction"
import type { SettingsResult } from "~/lib/mutations/settings"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import { Alert, Button, Field, Heading, Stack } from "@duro-app/ui"
import { Header } from "~/components/Header/Header"
import { LanguageSelect } from "~/components/LanguageSelect/LanguageSelect"
import { CertificateSection } from "~/components/CertificateSection/CertificateSection"
import { css, html } from "react-strict-dom"

const styles = css.create({
  page: {
    maxWidth: 600,
    margin: "0 auto",
    padding: "32px 16px",
  },
})

interface SettingsLoaderData {
  user: string
  isAdmin: boolean
  locale: string
  currentLocale: string
  email: string | null
  lastCertRenewalAt: string | null
  p12Password: string | null
  certificates: UserCertificate[]
}

export const loader: LoaderFunction<SettingsLoaderData> = async (request) => {
  try {
    const { requireAuth } = await import("~/lib/auth.server")
    const { runEffect } = await import("~/lib/runtime.server")
    const { PreferencesRepo } = await import("~/lib/services/PreferencesRepo.server")
    const { CertManager } = await import("~/lib/services/CertManager.server")
    const { CertificateRepo } = await import("~/lib/services/CertificateRepo.server")
    const { resolveLocale } = await import("~/lib/i18n.server")

    const auth = await requireAuth(request as unknown as Request)
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
    const { config } = await import("~/lib/config.server")
    return {
      user: auth.user ?? "",
      isAdmin: auth.groups.includes(config.adminGroupName),
      locale,
      currentLocale: resolveLocale(request as unknown as Request),
      email: auth.email,
      lastCertRenewalAt: lastCertRenewal.at?.toISOString() ?? null,
      p12Password,
      certificates,
    }
  } catch (e) {
    if (e instanceof Response) throw e
    // Dev mode fallback — dynamic imports don't resolve in Metro dev loader bundles
    return {
      user: "dev",
      isAdmin: true,
      locale: "en",
      currentLocale: "en",
      email: null,
      lastCertRenewalAt: null,
      p12Password: null,
      certificates: [],
    }
  }
}

export default function SettingsPage() {
  const { t } = useTranslation()
  const loaderData = useLoaderData<typeof loader>()
  const localeAction = useAction<SettingsResult>("/settings")
  const actionData = localeAction.data

  return (
    <>
      <Header user={loaderData.user} isAdmin={loaderData.isAdmin} />
      <html.main style={styles.page}>
        <Heading level={1}>{t("settings.heading")}</Heading>

        {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}

        <localeAction.Form>
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
        </localeAction.Form>

        <CertificateSection
          email={loaderData.email}
          p12Password={loaderData.p12Password}
          lastCertRenewalAt={loaderData.lastCertRenewalAt}
          certificates={loaderData.certificates}
        />
      </html.main>
    </>
  )
}
