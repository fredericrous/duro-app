import { useTranslation } from "react-i18next"
import { useRouteLoaderData } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/devices"
import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { parseSettingsMutation, handleSettingsMutation } from "~/lib/mutations/settings"
import { Header } from "~/components/Header/Header"
import { CardSection } from "~/components/CardSection/CardSection"
import { DevicesSection } from "~/components/DevicesSection/DevicesSection"
import { PageShell } from "@duro-app/ui"

export function meta() {
  return [{ title: "Devices - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  const { lastCertRenewalAt, certificates } = await runEffect(
    Effect.gen(function* () {
      const prefs = yield* PreferencesRepo
      const certRepo = yield* CertificateRepo
      const lastCertRenewal = yield* prefs.getLastCertRenewal(auth.user!)
      // Unrevoked rather than valid: an expired certificate has to stay on
      // screen, because renewing it is the whole point of coming here.
      const certificates = yield* certRepo.listUnrevoked(auth.user!).pipe(Effect.catchAll(() => Effect.succeed([])))
      return { lastCertRenewalAt: lastCertRenewal.at?.toISOString() ?? null, certificates }
    }),
  )
  return { email: auth.email, lastCertRenewalAt, certificates }
}

export async function action({ request }: Route.ActionArgs) {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    return Response.json({ error: "Invalid origin" }, { status: 403 })
  }
  const auth = await requireAuth(request)
  const formData = await request.formData()
  const parsed = parseSettingsMutation(formData as unknown as FormData, auth)
  if ("error" in parsed) return parsed
  return await runEffect(handleSettingsMutation(parsed).pipe(Effect.orDie))
}

export default function DevicesPage({ loaderData }: Route.ComponentProps) {
  const { t } = useTranslation()
  const dashboardData = useRouteLoaderData("routes/dashboard") as { user?: string; isAdmin?: boolean } | undefined
  const user = dashboardData?.user ?? ""
  const isAdmin = dashboardData?.isAdmin ?? false

  return (
    <PageShell maxWidth="lg" header={<Header user={user} isAdmin={isAdmin} />}>
      <CardSection title={t("devices.heading")}>
        <DevicesSection
          email={loaderData.email}
          lastCertRenewalAt={loaderData.lastCertRenewalAt}
          certificates={loaderData.certificates}
        />
      </CardSection>
    </PageShell>
  )
}
