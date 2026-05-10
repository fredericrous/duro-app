import { Effect } from "effect"
import { Outlet, redirect } from "react-router"
import type { Route } from "./+types/dashboard"
import { requireAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { isFirstRun } from "~/lib/governance/bootstrap.server"
import { runEffect } from "~/lib/runtime.server"
import { authMode } from "~/lib/governance-mode.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"

export async function loader({ request }: Route.LoaderArgs) {
  // First-run shortcut: if there are no human users yet, send the visitor
  // to the setup wizard before the OIDC redirect that requireAuth would
  // otherwise trigger. The /admin/setup route is mounted as a sibling of
  // this layout so the redirect cannot loop.
  if (await runEffect(isFirstRun)) {
    throw redirect("/admin/setup")
  }
  const auth = await requireAuth(request)
  const adminDecision = await checkAuthDecision({ auth, application: "duro", action: "admin" })

  // Resolve the governance principal id once for descendants that need it
  // (mostly /requests). The catalog itself moved to per-route loaders + the
  // GET /api/catalog endpoint so it doesn't fire on every navigation.
  let currentPrincipalId: string | null = null
  if (authMode !== "legacy" && auth.sub) {
    try {
      currentPrincipalId = await runEffect(
        Effect.gen(function* () {
          const repo = yield* PrincipalRepo
          const principal = yield* repo.findByExternalId(auth.sub!)
          return principal?.id ?? null
        }),
      )
    } catch (err) {
      await runEffect(Effect.logWarning("dashboard principal load failed", { error: String(err) }))
    }
  }

  return {
    user: auth.user,
    email: auth.email,
    groups: auth.groups,
    isAdmin: adminDecision.allow,
    currentPrincipalId,
  }
}

export default function DashboardLayout() {
  return <Outlet />
}
