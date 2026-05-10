import { Effect } from "effect"
import type { Route } from "./+types/api.catalog"
import { runEffect } from "~/lib/runtime.server"
import { authMode } from "~/lib/governance-mode.server"
import { PrincipalRepo } from "~/lib/governance/PrincipalRepo.server"
import { loadAppsCatalogForPrincipal, type AppCatalogEntry } from "~/lib/apps-catalog.server"

// On-demand catalog endpoint for the Header dialog. The catalog used to live
// on the dashboard layout loader and fired on every page navigation; this
// endpoint replaces that broad-cast load with a per-action fetch (the dialog
// calls fetcher.load("/api/catalog") when it opens).
export async function loader({ request }: Route.LoaderArgs) {
  const { requireAuth } = await import("~/lib/auth.server")
  const auth = await requireAuth(request)

  if (authMode === "legacy" || !auth.sub) {
    return Response.json({ apps: [] as AppCatalogEntry[] })
  }

  const apps = await runEffect(
    Effect.gen(function* () {
      const repo = yield* PrincipalRepo
      const principal = yield* repo.findByExternalId(auth.sub!)
      if (!principal) return [] as AppCatalogEntry[]
      return yield* loadAppsCatalogForPrincipal(principal.id)
    }),
  ).catch(() => [] as AppCatalogEntry[])

  return Response.json({ apps })
}
