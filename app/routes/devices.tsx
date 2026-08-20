import { useRouteLoaderData } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/devices"
import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { PreferencesRepo } from "~/lib/services/PreferencesRepo.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { findPendingClaim } from "~/lib/workflows/cert-reveal.server"
import { parseSettingsMutation, handleSettingsMutation } from "~/lib/mutations/settings"
import { Header } from "~/components/Header/Header"
import { DevicesSection } from "~/components/DevicesSection/DevicesSection"
import { PageShell } from "@duro-app/ui"

export function meta() {
  return [{ title: "Devices - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  const { lastCertRenewalAt, certificates, pendingClaim } = await runEffect(
    Effect.gen(function* () {
      const prefs = yield* PreferencesRepo
      const certRepo = yield* CertificateRepo
      const lastCertRenewal = yield* prefs.getLastCertRenewal(auth.user!)
      // Unrevoked rather than valid: an expired certificate has to stay on
      // screen, because renewing it is the whole point of coming here.
      const certificates = yield* certRepo.listUnrevoked(auth.user!).pipe(Effect.catchAll(() => Effect.succeed([])))
      // Existence and expiry ONLY. The claim link is a bearer secret, so it
      // never rides a GET — the showClaimLink POST hands it over.
      const pendingClaim = yield* findPendingClaim(auth.user!).pipe(Effect.catchAll(() => Effect.succeed(null)))
      return { lastCertRenewalAt: lastCertRenewal.at?.toISOString() ?? null, certificates, pendingClaim }
    }),
  )
  return { email: auth.email, lastCertRenewalAt, certificates, pendingClaim }
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
  const dashboardData = useRouteLoaderData("routes/dashboard") as { user?: string; isAdmin?: boolean } | undefined
  const user = dashboardData?.user ?? ""
  const isAdmin = dashboardData?.isAdmin ?? false

  return (
    <PageShell maxWidth="lg" header={<Header user={user} isAdmin={isAdmin} />}>
      <DevicesSection
        lastCertRenewalAt={loaderData.lastCertRenewalAt}
        certificates={loaderData.certificates}
        pendingClaim={loaderData.pendingClaim}
      />
    </PageShell>
  )
}
