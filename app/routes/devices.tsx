import { data, useRouteLoaderData } from "react-router"
import { Effect } from "effect"
import type { Route } from "./+types/devices"
import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { isOriginAllowed } from "~/lib/config.server"
import { CertificateRepo } from "~/lib/services/CertificateRepo.server"
import { findPendingClaim } from "~/lib/workflows/cert-reveal.server"
import { deviceBudget } from "~/lib/workflows/device-budget.server"
import {
  presentedRevokedNotice,
  presentedSerial,
  readCookie,
  REVOKED_NOTICE_COOKIE,
  revokedNoticeCookie,
} from "~/lib/workflows/presented-cert.server"
import { parseSettingsMutation, handleSettingsMutation } from "~/lib/mutations/settings"
import { Header } from "~/components/Header/Header"
import { DevicesSection } from "~/components/DevicesSection/DevicesSection"
import { PageShell } from "@greenharness/greenrack-ui"

export function meta() {
  return [{ title: "Devices - Duro" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request)
  const xfcc = request.headers.get("x-forwarded-client-cert")
  // The certificate this device presented, when it is one of the user's own
  // and revoked: the page then says so and offers a new one.
  const presentedRevokedLookup = presentedRevokedNotice(xfcc, auth.user)
  const { budget, certificates, pendingClaim, presentedRevoked } = await runEffect(
    Effect.gen(function* () {
      const certRepo = yield* CertificateRepo
      const budget = yield* deviceBudget(auth.user!)
      // Unrevoked rather than valid: an expired certificate has to stay on
      // screen, because renewing it is the whole point of coming here.
      const certificates = yield* certRepo.listUnrevoked(auth.user!).pipe(Effect.catchAll(() => Effect.succeed([])))
      // Existence and expiry ONLY. The claim link is a bearer secret, so it
      // never rides a GET — the showClaimLink POST hands it over.
      const pendingClaim = yield* findPendingClaim(auth.user!).pipe(Effect.catchAll(() => Effect.succeed(null)))
      const presentedRevoked = yield* presentedRevokedLookup
      return { budget, certificates, pendingClaim, presentedRevoked }
    }),
  )
  const payload = { email: auth.email, budget, certificates, pendingClaim, presentedRevoked }

  // Home redirects here once a day per revoked serial: the cookie that stops
  // it is set only once the notice is shown, so a failed lookup here leaves
  // the redirect to retry. A matching cookie is not refreshed (a fixed day).
  const serial = presentedRevoked ? presentedSerial(xfcc) : null
  if (serial !== null && readCookie(request.headers.get("cookie"), REVOKED_NOTICE_COOKIE) !== serial) {
    return data(payload, { headers: { "Set-Cookie": revokedNoticeCookie(serial) } })
  }
  return payload
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
        budget={loaderData.budget}
        certificates={loaderData.certificates}
        pendingClaim={loaderData.pendingClaim}
        presentedRevoked={loaderData.presentedRevoked}
      />
    </PageShell>
  )
}
