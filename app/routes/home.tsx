import { Effect } from "effect"
import type { Route } from "./+types/home"
import { getVisibleApps } from "~/lib/apps.server"
import { config, isOriginAllowed } from "~/lib/config.server"
import { Header } from "~/components/Header/Header"
import { AppGrid } from "~/components/AppGrid/AppGrid"
import { NoAccess } from "~/components/NoAccess/NoAccess"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { PageShell } from "@duro-app/ui"
import { useFetcher, useRouteLoaderData } from "react-router"
import { authMode } from "~/lib/governance-mode.server"
import { runEffect } from "~/lib/runtime.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { AuthzEngine } from "~/lib/governance/AuthzEngine.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { submitAccessRequest } from "~/lib/workflows/access-request.server"
import { loadAppsCatalogForPrincipal, type AppCatalogEntry } from "~/lib/apps-catalog.server"
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
            subject: auth.sub!,
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
                // Empty string signals "no launch URL configured" — AppCard
                // renders a non-link state with a help hint instead of a 404.
                url: a.url ?? "",
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
        const govSlugs = new Set(governedApps.map((a) => a.id))
        const uniqueStatic = staticApps.filter((a) => !govSlugs.has(a.id))
        visibleApps = [...governedApps, ...uniqueStatic]
      } else {
        visibleApps = governedApps
      }
    } catch (err) {
      await runEffect(
        Effect.logWarning("governance app visibility failed, falling back to static", { error: String(err) }),
      )
    }
  }

  // Only load the catalog if we'll actually render NoAccess. The header
  // dialog fetches its own catalog from /api/catalog on demand.
  let appsCatalog: AppCatalogEntry[] = []
  if (authMode !== "legacy" && auth.user && visibleApps.length === 0) {
    try {
      appsCatalog = await runEffect(
        Effect.gen(function* () {
          const principalRepo = yield* PrincipalRepo
          const principal = yield* principalRepo.findByExternalId(auth.sub!)
          if (!principal) return [] as AppCatalogEntry[]
          return yield* loadAppsCatalogForPrincipal(principal.id)
        }),
      )
    } catch (err) {
      await runEffect(Effect.logWarning("home catalog load failed", { error: String(err) }))
    }
  }

  return {
    visibleApps,
    categoryOrder: config.categoryOrder,
    appsCatalog,
  }
}

// Discriminated outcomes for the submit action — split clean states so the
// form/dialog can branch on intent without overloading a `success` flag.
export type SubmitOutcome =
  | { outcome: "submitted"; requestId: string }
  | { outcome: "auto_approved"; requestId: string }
  | { outcome: "duplicate"; requestId: string }
  | { outcome: "error"; error: string }

export async function action({ request }: Route.ActionArgs): Promise<SubmitOutcome | Response> {
  if (!isOriginAllowed(request.headers.get("Origin"))) {
    return Response.json({ outcome: "error", error: "invalid_origin" }, { status: 403 })
  }

  const { getAuth } = await import("~/lib/auth.server")
  const { PrincipalRepo } = await import("~/lib/governance/PrincipalRepo.server")
  const auth = await getAuth(request)
  if (!auth.user) {
    return { outcome: "error", error: "not_authenticated" }
  }

  const formData = await request.formData()
  const intent = formData.get("intent") as string | null

  if (intent === "requestAccess") {
    const applicationId = (formData.get("applicationId") as string)?.trim()
    const roleId = ((formData.get("roleId") as string) ?? "").trim() || undefined
    const justification = ((formData.get("justification") as string) ?? "").trim() || undefined
    if (!applicationId) return { outcome: "error", error: "missing_application" }
    if (!roleId) return { outcome: "error", error: "missing_target" }

    // The user-facing form is role-only by design (audit M9): entitlements are
    // an admin-side concept. Requests for entitlements still flow through
    // /api/access-requests for programmatic callers.
    try {
      const result = await runEffect(
        Effect.gen(function* () {
          const principalRepo = yield* PrincipalRepo
          const principal = yield* principalRepo.findByExternalId(auth.sub!)
          if (!principal) return yield* Effect.fail("principal_not_found" as const)
          return yield* submitAccessRequest({
            requesterId: principal.id,
            applicationId,
            roleId,
            justification,
          })
        }),
      )
      if (result.status === "duplicate") return { outcome: "duplicate", requestId: result.requestId }
      if (result.status === "approved") return { outcome: "auto_approved", requestId: result.requestId }
      return { outcome: "submitted", requestId: result.requestId }
    } catch (e) {
      const tag = (e as { _tag?: string } | null)?._tag
      if (tag === "MissingRoleOrEntitlementError") return { outcome: "error", error: "missing_target" }
      if (tag === "BothRoleAndEntitlementError") return { outcome: "error", error: "role_entitlement_conflict" }
      if (tag === "RoleEntitlementAppMismatchError") return { outcome: "error", error: "role_entitlement_app_mismatch" }
      console.error("[home] requestAccess failed:", e)
      return { outcome: "error", error: "submit_failed" }
    }
  }

  return { outcome: "error", error: "unknown_intent" }
}

export default function HomePage({ loaderData }: Route.ComponentProps) {
  const { visibleApps, categoryOrder, appsCatalog } = loaderData
  const fetcher = useFetcher<typeof action>()
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
        <NoAccess
          user={user}
          requestableApps={appsCatalog.filter((e) => e.state === "requestable")}
          fetcher={fetcher}
        />
      </CenteredCardPage>
    )
  }

  return (
    <PageShell maxWidth="lg" header={<Header user={user} isAdmin={isAdmin} />}>
      <AppGrid apps={visibleApps} categoryOrder={categoryOrder} />
    </PageShell>
  )
}
