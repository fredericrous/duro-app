import { useTranslation } from "react-i18next"
import { useLoaderData } from "expo-router"
import type { LoaderFunction } from "expo-server"
import { Effect } from "effect"
import { devSettingsFallback } from "../../server/dev-fallbacks"
import { useAction } from "~/hooks/useAction"
import type { SettingsResult } from "~/lib/mutations/settings"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"
import { Alert, Button, Field, PageShell, Stack } from "@duro-app/ui"
import { Header } from "~/components/Header/Header"
import { CardSection } from "~/components/CardSection/CardSection"
import { LanguageSelect } from "~/components/LanguageSelect/LanguageSelect"
import { CertificateSection } from "~/components/CertificateSection/CertificateSection"

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
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { requireAuth } = require("~/lib/auth.server")
  if (typeof requireAuth !== "function") return devSettingsFallback

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { runEffect } = require("~/lib/runtime.server")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { config } = require("~/lib/config.server")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolveLocale } = require("~/lib/i18n.server")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PreferencesRepo } = require("~/lib/services/PreferencesRepo.server")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CertManager } = require("~/lib/services/CertManager.server")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { CertificateRepo } = require("~/lib/services/CertificateRepo.server")
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
}

export default function SettingsPage() {
  const { t } = useTranslation()
  const loaderData = useLoaderData<typeof loader>()
  const localeAction = useAction<SettingsResult>("/settings")
  const actionData = localeAction.data

  return (
    <PageShell maxWidth="sm" header={<Header user={loaderData.user} isAdmin={loaderData.isAdmin} />}>
      <CardSection title={t("settings.languageLabel")}>
        {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}

        <localeAction.Form>
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
        </localeAction.Form>
      </CardSection>

      <CardSection title={t("settings.cert.heading")}>
        <CertificateSection
          email={loaderData.email}
          p12Password={loaderData.p12Password}
          lastCertRenewalAt={loaderData.lastCertRenewalAt}
          certificates={loaderData.certificates}
        />
      </CardSection>
    </PageShell>
  )
}
