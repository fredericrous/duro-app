import { useTranslation } from "react-i18next"
import { Effect } from "effect"
import type { Route } from "./+types/settings.certificate"
import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import { CertManager } from "~/lib/services/CertManager.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { parseSettingsMutation, handleSettingsMutation } from "~/lib/mutations/settings"
import { CardSection } from "~/components/CardSection/CardSection"
import { CertificateSection } from "~/components/CertificateSection/CertificateSection"

export function meta() {
  return [{ title: "Certificate - Duro settings" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  const { lastCertRenewalAt, p12Password, certificates } = await runEffect(
    Effect.gen(function* () {
      const prefs = yield* PreferencesRepo
      const cert = yield* CertManager
      const certRepo = yield* CertificateRepo
      const lastCertRenewal = yield* prefs.getLastCertRenewal(auth.user!)
      const p12Password = lastCertRenewal.renewalId
        ? yield* cert.getP12Password(lastCertRenewal.renewalId).pipe(Effect.catchAll(() => Effect.succeed(null)))
        : null
      const certificates = yield* certRepo.listValid(auth.user!).pipe(Effect.catchAll(() => Effect.succeed([])))
      return { lastCertRenewalAt: lastCertRenewal.at?.toISOString() ?? null, p12Password, certificates }
    }),
  )
  return { email: auth.email, lastCertRenewalAt, p12Password, certificates }
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request)
  const formData = await request.formData()
  const parsed = parseSettingsMutation(formData as unknown as FormData, auth)
  if ("error" in parsed) return parsed
  return await runEffect(handleSettingsMutation(parsed))
}

export default function CertificateSettings({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  return (
    <CardSection title={t("settings.cert.heading")}>
      <CertificateSection
        email={loaderData.email}
        p12Password={loaderData.p12Password}
        lastCertRenewalAt={loaderData.lastCertRenewalAt}
        certificates={loaderData.certificates}
      />
    </CardSection>
  )
}
