import { Suspense, use } from "react"
import { Effect } from "effect"
import type { Route } from "./+types/home"
import { getVisibleApps, loadApps } from "~/lib/apps.server"
import { config, isOriginAllowed } from "~/lib/config.server"
import { Header } from "~/components/Header/Header"
import { AppGrid } from "~/components/AppGrid/AppGrid"
import { NoAccess } from "~/components/NoAccess/NoAccess"
import { CenteredCardPage } from "~/components/CenteredCardPage/CenteredCardPage"
import { AppSearchBar, AppSearchBarSkeleton } from "~/components/AppSearchBar/AppSearchBar"
import { EmptyState, PageShell, Stack, Button } from "@duro-app/ui"
import { useFetcher, useRouteLoaderData } from "react-router"
import { useTranslation } from "react-i18next"
import { runEffect } from "~/lib/runtime.server"
import { ApplicationRepo } from "~/lib/governance/ApplicationRepo.server"
import { AuthzEngine } from "~/lib/governance/AuthzEngine.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { submitAccessRequest } from "~/lib/workflows/access-request.server"
import { loadAppsCatalogForPrincipal, type AppCatalogEntry } from "~/lib/apps-catalog.server"
import type { AppDefinition } from "~/lib/apps"
import { formatCategory, getCategoryOrder } from "~/lib/apps"
import { filterByQuery } from "~/lib/search"
import { useAppSearchParams } from "~/hooks/useAppSearchParams"

export function meta() {
  return [{ title: "Home - Duro" }, { name: "description", content: "Your personal app dashboard" }]
}

interface HomeData {
  visibleApps: AppDefinition[]
  appsCatalog: AppCatalogEntry[]
}

/**
 * Resolves the slow paths in one async block: governance-aware app visibility
 * + (only when the user has no apps) the catalog for the NoAccess form.
 *
 * Returned to the loader as an unawaited Promise so the route shell streams
 * before this finishes — see HomePage's <Suspense> below.
 */
async function loadHomeData(request: Request): Promise<HomeData> {
  const { getAuth } = await import("~/lib/auth.server")
  const auth = await getAuth(request)
  const staticApps = getVisibleApps(auth.groups)

  let visibleApps = staticApps

  if (auth.user) {
    try {
      // Governance owns *visibility* (which apps a user may see); it does not
      // store *presentation* (icon, category, launch URL — the operator/DB has
      // none of these). Recover those from apps.json by slug so the grid keeps
      // its icons, real categories, and working launch links. Apps not in
      // apps.json still render (name from the DB), just unstyled + no link.
      const staticBySlug = new Map(loadApps().map((a) => [a.id, a]))
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
            .map((a): AppDefinition => {
              const s = staticBySlug.get(a.slug)
              return {
                id: a.slug,
                name: a.displayName || s?.name || a.slug,
                // Empty URL signals "no launch URL configured" — AppCard renders
                // a non-link state with a help hint instead of a 404.
                url: a.url ?? s?.url ?? "",
                category: s?.category ?? "governance",
                icon: s?.icon ?? "",
                groups: [],
                priority: s?.priority ?? 10,
                description: a.description ?? s?.description ?? null,
              }
            })
        }),
      )

      visibleApps = governedApps
    } catch (err) {
      await runEffect(
        Effect.logWarning("governance app visibility failed, falling back to static", { error: String(err) }),
      )
    }
  }

  let appsCatalog: AppCatalogEntry[] = []
  if (auth.user && visibleApps.length === 0) {
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

  return { visibleApps, appsCatalog }
}

export async function loader({ request }: Route.LoaderArgs) {
  // Defer the slow path so the page shell paints before checkBulk finishes.
  // React Router v7 streams unawaited promises in single-fetch responses; the
  // client consumes via Suspense + use() in HomeBody below.
  return {
    homeDataPromise: loadHomeData(request),
    categoryOrder: config.categoryOrder,
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

    // Tagged-error mapping must happen INSIDE the Effect via Effect.catchTag.
    // The previous `try/catch` read `(e as {_tag}).tag` on what's actually a
    // FiberFailure wrapper from runPromise — that match never fired in
    // production, so every workflow error collapsed to "submit_failed".
    const outcome = await runEffect(
      Effect.gen(function* () {
        const principalRepo = yield* PrincipalRepo
        const principal = yield* principalRepo.findByExternalId(auth.sub!)
        if (!principal) return { _kind: "principal_not_found" as const }
        const result = yield* submitAccessRequest({
          requesterId: principal.id,
          applicationId,
          roleId,
          justification,
        })
        if (result.status === "duplicate") return { _kind: "duplicate" as const, requestId: result.requestId }
        if (result.status === "approved") return { _kind: "auto_approved" as const, requestId: result.requestId }
        return { _kind: "submitted" as const, requestId: result.requestId }
      }).pipe(
        Effect.catchTag("MissingRoleOrEntitlementError", () => Effect.succeed({ _kind: "missing_target" as const })),
        Effect.catchTag("BothRoleAndEntitlementError", () =>
          Effect.succeed({ _kind: "role_entitlement_conflict" as const }),
        ),
        Effect.catchTag("RoleEntitlementAppMismatchError", () =>
          Effect.succeed({ _kind: "role_entitlement_app_mismatch" as const }),
        ),
        Effect.catchAll((e) => {
          console.error("[home] requestAccess failed:", e)
          return Effect.succeed({ _kind: "submit_failed" as const })
        }),
      ),
    )

    if (outcome._kind === "submitted") return { outcome: "submitted", requestId: outcome.requestId }
    if (outcome._kind === "auto_approved") return { outcome: "auto_approved", requestId: outcome.requestId }
    if (outcome._kind === "duplicate") return { outcome: "duplicate", requestId: outcome.requestId }
    return { outcome: "error", error: outcome._kind }
  }

  return { outcome: "error", error: "unknown_intent" }
}

export default function HomePage({ loaderData }: Route.ComponentProps) {
  const { homeDataPromise, categoryOrder } = loaderData
  const dashboardData = useRouteLoaderData("routes/dashboard") as {
    user: string
    isAdmin: boolean
  }
  const user = dashboardData?.user ?? ""
  const isAdmin = dashboardData?.isAdmin ?? false

  return (
    <PageShell maxWidth="lg" header={<Header user={user} isAdmin={isAdmin} />}>
      <Suspense fallback={<AppSearchBarSkeleton />}>
        <HomeBody promise={homeDataPromise} categoryOrder={categoryOrder} user={user} />
      </Suspense>
    </PageShell>
  )
}

/**
 * Renders only after the deferred homeDataPromise resolves. Owns the search/
 * chip state via useAppSearchParams. Decides NoAccess vs grid based on the
 * resolved data — pushing this branch inside Suspense means the page chrome
 * paints before the slow auth check completes.
 */
function HomeBody({
  promise,
  categoryOrder,
  user,
}: {
  promise: Promise<HomeData>
  categoryOrder: string[]
  user: string
}) {
  const { visibleApps, appsCatalog } = use(promise)
  const { t } = useTranslation()
  const fetcher = useFetcher<typeof action>()
  const { query, deferredQuery, selected, setQuery, setSelected, clearAll } = useAppSearchParams("cat")

  if (visibleApps.length === 0) {
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

  const categoryLabel = (cat: string) => {
    const key = `categories.${cat}`
    const translated = t(key)
    return translated === key ? formatCategory(cat) : translated
  }

  // Chip set is the categories present in visibleApps, ordered by the same
  // configuredOrder used downstream by AppGrid so chip order matches section
  // order. Counts let the user see how many apps each chip surfaces.
  const order = getCategoryOrder(visibleApps, categoryOrder)
  const counts = new Map<string, number>()
  for (const a of visibleApps) counts.set(a.category, (counts.get(a.category) ?? 0) + 1)
  const categoryChips = order
    .filter((c) => counts.has(c))
    .map((value) => ({
      value,
      label: categoryLabel(value),
      count: counts.get(value),
    }))

  const byCat = selected.length === 0 ? visibleApps : visibleApps.filter((a) => selected.includes(a.category))
  const filtered = filterByQuery(byCat, deferredQuery, ["name", "category"])

  return (
    <Stack gap="lg">
      <AppSearchBar
        query={query}
        onQueryChange={setQuery}
        chips={categoryChips}
        selected={selected}
        onSelectedChange={setSelected}
        placeholder={t("search.placeholder")}
        clearLabel={t("search.clearInput")}
      />
      {filtered.length === 0 ? (
        <EmptyState
          message={t("search.noResults")}
          action={
            <Button variant="secondary" onClick={clearAll}>
              {t("search.clearFilters")}
            </Button>
          }
        />
      ) : (
        <AppGrid apps={filtered} categoryOrder={categoryOrder} />
      )}
    </Stack>
  )
}
