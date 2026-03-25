import { Effect } from "effect"
import type { Route } from "./+types/home"
import { getVisibleApps } from "~/lib/apps.server"
import { config } from "~/lib/config.server"
import { Header } from "~/components/Header/Header"
import { AppGrid } from "~/components/AppGrid/AppGrid"
import { NoAccess } from "~/components/NoAccess/NoAccess"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { PageShell } from "@duro-app/ui"
import { useRouteLoaderData } from "react-router"
import { authMode } from "~/lib/governance-mode.server"
import { runEffect } from "~/lib/runtime.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { AuthzEngine } from "~/lib/governance/AuthzEngine.server"
import type { AppDefinition } from "~/lib/apps"

export function meta() {
  return [{ title: "Home - Duro" }, { name: "description", content: "Your personal app dashboard" }]
}

export async function loader({ request }: Route.LoaderArgs) {
  const { getAuth } = await import("~/lib/auth.server")
  const auth = await getAuth(request)

  // Static apps from apps.json (always resolved for legacy/shadow/dual)
  const staticApps = getVisibleApps(auth.groups)

  let visibleApps = staticApps

  if (authMode !== "legacy" && auth.user) {
    try {
      const governedApps = await runEffect(
        Effect.gen(function* () {
          const appRepo = yield* ApplicationRepo
          const engine = yield* AuthzEngine
          const allApps = yield* appRepo.list()
          const checks = allApps.map((a) => ({
            subject: auth.user!,
            application: a.slug,
            action: "access",
          }))
          const decisions = yield* engine.checkBulk(checks)
          return allApps
            .filter((_, i) => decisions[i].allow)
            .map(
              (a): AppDefinition => ({
                id: a.slug,
                name: a.displayName,
                url: "#", // governance apps don't have URLs in the table yet
                category: "governance",
                icon: "",
                groups: [],
                priority: 10,
              }),
            )
        }),
      )

      if (authMode === "shadow") {
        // Log but don't change behavior
        const govSlugs = new Set(governedApps.map((a) => a.id))
        const staticSlugs = new Set(staticApps.map((a) => a.id))
        const onlyGov = governedApps.filter((a) => !staticSlugs.has(a.id))
        const onlyStatic = staticApps.filter((a) => !govSlugs.has(a.id))
        if (onlyGov.length > 0 || onlyStatic.length > 0) {
          await runEffect(
            Effect.logWarning("app visibility mismatch", {
              user: auth.user,
              govOnly: onlyGov.map((a) => a.id),
              staticOnly: onlyStatic.map((a) => a.id),
            }),
          )
        }
      } else if (authMode === "dual") {
        // Governance first; if governance returns apps, use those + static
        // But avoid duplicates: governance takes precedence
        const govSlugs = new Set(governedApps.map((a) => a.id))
        const uniqueStatic = staticApps.filter((a) => !govSlugs.has(a.id))
        visibleApps = [...governedApps, ...uniqueStatic]
      } else {
        // governance mode: only governed apps
        visibleApps = governedApps
      }
    } catch (err) {
      await runEffect(
        Effect.logWarning("governance app visibility failed, falling back to static", { error: String(err) }),
      )
    }
  }

  return {
    visibleApps,
    categoryOrder: config.categoryOrder,
  }
}

export default function HomePage({ loaderData }: Route.ComponentProps) {
  const { visibleApps, categoryOrder } = loaderData
  const dashboardData = useRouteLoaderData("routes/dashboard") as {
    user: string
    isAdmin: boolean
  }
  const user = dashboardData?.user ?? ""
  const isAdmin = dashboardData?.isAdmin ?? false
  const hasAccess = visibleApps.length > 0

  if (!hasAccess) {
    return (
      <CenteredCardPage>
        <NoAccess user={user} />
      </CenteredCardPage>
    )
  }

  return (
    <PageShell maxWidth="lg" header={<Header user={user} isAdmin={isAdmin} />}>
      <AppGrid apps={visibleApps} categoryOrder={categoryOrder} />
    </PageShell>
  )
}
