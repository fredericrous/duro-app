import { Effect } from "effect"
import type { Plugin, GrantContext, PluginServices, ProvisioningTemplate } from "../../contracts"
import { PluginError } from "../../errors"
import { manifest, type ForgejoTeamsConfig } from "./manifest"

const provisioningTemplates: ReadonlyArray<ProvisioningTemplate> = [
  {
    appSlug: "forgejo",
    config: {
      // The PUBLIC host on purpose: ScopedHttpClient matches allowedDomains by
      // host and refuses plain http in prod. In-cluster, CoreDNS split-horizon
      // resolves git.daddyshome.fr to the no-mTLS forgejo-internal gateway
      // (verified 2026-08-16: 10.101.230.131 from the duro namespace).
      forgejoUrl: "https://git.daddyshome.fr",
      // Forgejo's org is `fredericrous` (org-teams-config.yaml) — NOT gitea's
      // `homelab`. Teams `viewers`/`editors` are created by the same job;
      // `Owners` is Forgejo's built-in owners team.
      orgName: "fredericrous",
      viewerTeamName: "viewers",
      editorTeamName: "editors",
      adminTeamName: "Owners",
    },
    mappings: { viewer: "viewers", editor: "editors", admin: "Owners" },
  },
]

interface ForgejoTeam {
  id: number
  name: string
  permission: string
}

const resolveTeamName = (config: ForgejoTeamsConfig, roleSlug: string): string | null => {
  switch (roleSlug) {
    case "viewer":
      return config.viewerTeamName
    case "editor":
      return config.editorTeamName
    case "admin":
      return config.adminTeamName
    default:
      return null
  }
}

const findTeamByName = (teams: ForgejoTeam[], name: string) => teams.find((t) => t.name === name)

/**
 * The Forgejo username is the OIDC `preferred_username` claim (Forgejo's
 * `oauth2_client.USERNAME`), which Duro stores as the principal's DISPLAY
 * NAME. `externalId` holds the opaque OIDC `sub` and must never be used here
 * — gitea-teams does, and that is a known latent bug tracked separately.
 */
const resolveForgeUsername = (ctx: GrantContext): Effect.Effect<string, PluginError> => {
  const username = ctx.principal.displayName?.trim() ?? ""
  if (username === "")
    return Effect.fail(
      new PluginError({
        message: `Principal ${ctx.principal.id} has no displayName — cannot resolve the Forgejo username`,
      }),
    )
  return Effect.succeed(encodeURIComponent(username))
}

const provision = (ctx: GrantContext, svc: PluginServices) =>
  Effect.gen(function* () {
    const config = ctx.config as ForgejoTeamsConfig
    const teamName = resolveTeamName(config, ctx.role.slug)
    if (!teamName) {
      yield* svc.log(`No team mapping for role ${ctx.role.slug}, skipping`)
      return
    }

    const username = yield* resolveForgeUsername(ctx)

    const teamsRaw = yield* svc.http.get(`${config.forgejoUrl}/api/v1/orgs/${config.orgName}/teams`, {
      secret: "token",
    })
    const teams = teamsRaw as ForgejoTeam[]

    const team = findTeamByName(teams, teamName)
    if (!team) {
      return yield* new PluginError({
        message: `Team '${teamName}' not found in org '${config.orgName}'. Create it first via the Forgejo setup job (org-teams-config).`,
      })
    }

    // PUT is idempotent on Forgejo — re-adding an existing member succeeds,
    // which is exactly what the worker's retry semantics need.
    yield* svc.http.put(`${config.forgejoUrl}/api/v1/teams/${team.id}/members/${username}`, {}, { secret: "token" })

    yield* svc.log("Forgejo team member added", {
      team: teamName,
      teamId: team.id,
      username,
    })
  })

const deprovision = (ctx: GrantContext, svc: PluginServices) =>
  Effect.gen(function* () {
    const config = ctx.config as ForgejoTeamsConfig
    const teamName = resolveTeamName(config, ctx.role.slug)
    if (!teamName) return

    const username = yield* resolveForgeUsername(ctx)

    const teamsRaw = yield* svc.http.get(`${config.forgejoUrl}/api/v1/orgs/${config.orgName}/teams`, {
      secret: "token",
    })
    const teams = teamsRaw as ForgejoTeam[]

    const team = findTeamByName(teams, teamName)
    if (!team) {
      yield* svc.log(`Team '${teamName}' not found, skipping deprovision`)
      return
    }

    // Idempotent deprovision: the member being already gone (404) is success —
    // ScopedHttpClient fails every non-2xx, so recover that one case here.
    yield* svc.http
      .del(`${config.forgejoUrl}/api/v1/teams/${team.id}/members/${username}`, { secret: "token" })
      .pipe(
        Effect.catchAll((e) =>
          e instanceof PluginError && /HTTP 404/.test(e.message)
            ? svc.log("Forgejo team member already absent, nothing to remove", { team: teamName, username })
            : Effect.fail(e),
        ),
      )

    yield* svc.log("Forgejo team member removed", {
      team: teamName,
      teamId: team.id,
      username,
    })
  })

export const forgejoTeamsPlugin: Plugin = {
  manifest,
  provisioningTemplates,
  provision,
  deprovision,
}
