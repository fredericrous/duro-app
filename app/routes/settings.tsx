import { useTranslation } from "react-i18next"
import { redirect, useFetcher, useRouteLoaderData } from "react-router"
import type { Route } from "./+types/settings"
import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { ApiKeyRepo } from "~/lib/governance/ApiKeyRepo.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { config } from "~/lib/config.server"
import { resolveLocale } from "~/lib/i18n.server"
import { handleSettingsMutation, parseSettingsMutation } from "~/lib/mutations/settings"
import { handleSettingsApiKeysMutation, parseSettingsApiKeysMutation } from "~/lib/mutations/settings-api-keys.server"
import { Effect } from "effect"
import { Alert, Button, Field, LinkButton, PageShell, Stack, Text } from "@duro-app/ui"
import { Header } from "~/components/Header/Header"
import { CardSection } from "~/components/CardSection/CardSection"
import { LanguageSelect } from "~/components/LanguageSelect/LanguageSelect"
import { CertificateSection } from "~/components/CertificateSection/CertificateSection"
import { ApiKeysSection } from "~/components/ApiKeysSection/ApiKeysSection"

export function meta() {
  return [{ title: "Settings - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  const { locale, lastCertRenewal, p12Password, certificates, apiKeys } = await runEffect(
    Effect.gen(function* () {
      const prefs = yield* PreferencesRepo
      const cert = yield* CertManager
      const certRepo = yield* CertificateRepo
      const apiKeyRepo = yield* ApiKeyRepo
      const principals = yield* PrincipalRepo
      const locale = yield* prefs.getLocale(auth.user!)
      const lastCertRenewal = yield* prefs.getLastCertRenewal(auth.user!)
      const p12Password = lastCertRenewal.renewalId
        ? yield* cert.getP12Password(lastCertRenewal.renewalId).pipe(Effect.catchAll(() => Effect.succeed(null)))
        : null
      const certificates = yield* certRepo.listValid(auth.user!).pipe(Effect.catchAll(() => Effect.succeed([])))
      const principal = auth.sub ? yield* principals.findByExternalId(auth.sub) : null
      const apiKeys = principal
        ? yield* apiKeyRepo.listForPrincipal(principal.id).pipe(Effect.catchAll(() => Effect.succeed([])))
        : []
      return { locale, lastCertRenewal, p12Password, certificates, apiKeys }
    }),
  )
  return {
    locale,
    currentLocale: resolveLocale(request),
    email: auth.email,
    lastCertRenewalAt: lastCertRenewal.at?.toISOString() ?? null,
    p12Password,
    certificates,
    apiKeys,
    autheliaUrl: config.autheliaUrl,
  }
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  const formData = await request.formData()
  const intent = formData.get("intent")

  if (intent === "createApiKey" || intent === "revokeApiKey") {
    const parsed = parseSettingsApiKeysMutation(formData as any, auth)
    if ("error" in parsed) return { apiKeyError: parsed.error }
    return await runEffect(handleSettingsApiKeysMutation(parsed))
  }

  const parsed = parseSettingsMutation(formData as any, auth)
  if ("error" in parsed) return parsed

  const result = await runEffect(handleSettingsMutation(parsed))
  if (result && typeof result === "object" && "_redirect" in result) {
    return redirect((result as any)._redirect, {
      headers: { "Set-Cookie": (result as any)._cookie },
    })
  }
  return result
}

export default function SettingsPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const dashboardData = useRouteLoaderData("routes/dashboard") as {
    user: string
    isAdmin: boolean
  }
  const fetcher = useFetcher<typeof action>()
  const actionData = fetcher.data

  return (
    <PageShell
      maxWidth="sm"
      header={<Header user={dashboardData?.user ?? ""} isAdmin={dashboardData?.isAdmin ?? false} />}
    >
      <Stack gap="lg">
        <CardSection title={t("settings.languageLabel")}>
          {actionData && "error" in actionData && <Alert variant="error">{actionData.error}</Alert>}

          <fetcher.Form method="post">
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
          </fetcher.Form>
        </CardSection>

        <CardSection title={t("settings.cert.heading")}>
          <CertificateSection
            email={loaderData.email}
            p12Password={loaderData.p12Password}
            lastCertRenewalAt={loaderData.lastCertRenewalAt}
            certificates={loaderData.certificates}
          />
        </CardSection>

        <CardSection title={t("settings.apiKeys.heading")}>
          <ApiKeysSection apiKeys={loaderData.apiKeys} />
        </CardSection>

        {loaderData.autheliaUrl && (
          <CardSection title={t("settings.security.heading")}>
            <Stack gap="sm">
              <Text as="p" color="muted" variant="bodySm">
                {t("settings.security.description")}
              </Text>
              <LinkButton href={loaderData.autheliaUrl} target="_blank" rel="noopener noreferrer" variant="secondary">
                {t("settings.security.openPortal")}
              </LinkButton>
              <Text as="p" color="muted" variant="bodySm">
                {t("settings.security.managedBy")}
              </Text>
            </Stack>
          </CardSection>
        )}
      </Stack>
    </PageShell>
  )
}
