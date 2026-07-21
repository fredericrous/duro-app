import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"
import { Outlet, redirect } from "react-router"
import type { Route } from "./+types/dashboard"
import { requireAuth } from "~/lib/auth.server"
import { checkAuthDecision } from "~/lib/auth-decision.server"
import { isFirstRun } from "~/lib/governance/bootstrap.server"
import { runEffect } from "~/lib/runtime.server"
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
  if (auth.sub) {
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

  // Count the items awaiting the user on their "My requests" page — their own
  // in-flight requests plus invitations still open for them — so the header can
  // badge the link and nudge them back to read it. Cheap raw-SQL counts; the
  // badge self-clears as requests are decided and invitations are answered.
  let openRequestItems = 0
  if (currentPrincipalId) {
    openRequestItems = await runEffect(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        const [reqs, invs] = yield* Effect.all([
          sql`SELECT count(*)::int AS n FROM access_requests
              WHERE requester_id = ${currentPrincipalId} AND status = 'pending'`,
          sql`SELECT count(*)::int AS n FROM access_invitations
              WHERE invited_principal_id = ${currentPrincipalId} AND status = 'pending'
                AND (expires_at IS NULL OR expires_at > now())`,
        ])
        const n = (r: readonly unknown[]) => ((r[0] as { n?: number } | undefined)?.n ?? 0) as number
        return n(reqs) + n(invs)
      }),
    ).catch(() => 0)
  }

  return {
    user: auth.user,
    email: auth.email,
    groups: auth.groups,
    isAdmin: adminDecision.allow,
    currentPrincipalId,
    openRequestItems,
  }
}

export default function DashboardLayout() {
  return <Outlet />
}
