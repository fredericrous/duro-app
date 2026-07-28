import { Effect } from "effect"
import type { Route } from "./+types/api.grants.export"
import { requireApiAuth, requireScope } from "~/lib/api-auth.server"
import { GrantRepo } from "~/lib/governance/GrantRepo.server"
import type { GrantExportRow } from "~/lib/governance/types"
import { runEffect } from "~/lib/runtime.server"

/**
 * GET /api/grants/export — full "who has access to what" snapshot for
 * machine consumers (CMDB/EA, e.g. application-landscape). One call returns
 * every ACTIVE grant with names resolved (grantee, application, role or
 * entitlement, optional resource, granting principal). Group grantees carry
 * a `members` array (single-hop) so the consumer can compute
 * person→application edges without further calls.
 *
 * Query params:
 *   ?application=<slug> — restrict to grants on one application.
 *
 * Auth: session or Bearer duro_ API key with scope `grants:read`.
 */

/** Nested response shape, built from the repo's flat joined row. */
function toExportGrant(row: GrantExportRow) {
  return {
    id: row.id,
    principal: {
      id: row.principalId,
      externalId: row.principalExternalId,
      displayName: row.principalDisplayName,
      email: row.principalEmail,
      principalType: row.principalType,
    },
    application: {
      slug: row.applicationSlug,
      displayName: row.applicationDisplayName,
    },
    role: row.roleSlug === null ? null : { slug: row.roleSlug, displayName: row.roleDisplayName },
    entitlement:
      row.entitlementSlug === null ? null : { slug: row.entitlementSlug, displayName: row.entitlementDisplayName },
    resource:
      row.resourceExternalId === null && row.resourceDisplayName === null
        ? null
        : { externalId: row.resourceExternalId, displayName: row.resourceDisplayName },
    // Non-null iff the grantee is a group ([] for an empty group).
    members: row.members,
    grantedBy: {
      id: row.grantedById,
      externalId: row.grantedByExternalId,
      displayName: row.grantedByDisplayName,
    },
    reason: row.reason,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  try {
    const auth = await requireApiAuth(request)
    requireScope(auth, "grants:read")

    const application = new URL(request.url).searchParams.get("application")

    const rows = await runEffect(
      Effect.gen(function* () {
        const repo = yield* GrantRepo
        return yield* repo.exportActive(application ? { applicationSlug: application } : undefined)
      }).pipe(Effect.orDie),
    )

    return Response.json({ grants: rows.map(toExportGrant), exportedAt: new Date().toISOString() })
  } catch (err) {
    if (err instanceof Response) throw err
    return Response.json({ error: `Failed to export grants: ${err}` }, { status: 500 })
  }
}
