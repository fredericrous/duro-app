import { Effect } from "effect"
import type { Plugin, GrantContext, PluginServices, ProvisioningTemplate } from "../../contracts"
import { PluginError } from "../../errors"
import { manifest, type GiteaTeamsConfig } from "./manifest"

const provisioningTemplates: ReadonlyArray<ProvisioningTemplate> = [
  {
    appSlug: "gitea",
    config: {
      giteaUrl: "https://gitea.daddyshome.fr",
      orgName: "homelab",
      viewerTeamName: "viewers",
      editorTeamName: "editors",
      adminTeamName: "Owners",
    },
    mappings: { viewer: "viewers", editor: "editors", admin: "Owners" },
  },
]

interface GiteaTeam {
  id: number
  name: string
  permission: string
}

const resolveTeamName = (config: GiteaTeamsConfig, roleSlug: string): string | null => {
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

const findTeamByName = (teams: GiteaTeam[], name: string) => teams.find((t) => t.name === name)

const provision = (ctx: GrantContext, svc: PluginServices) =>
  Effect.gen(function* () {
    const config = ctx.config as GiteaTeamsConfig
    const teamName = resolveTeamName(config, ctx.role.slug)
    if (!teamName) {
      yield* svc.log(`No team mapping for role ${ctx.role.slug}, skipping`)
      return
    }

    if (!ctx.principal.externalId) {
      return yield* new PluginError({
        message: `Principal ${ctx.principal.id} has no externalId — cannot resolve Gitea username`,
      })
    }

    const teamsRaw = yield* svc.http.get(`${config.giteaUrl}/api/v1/orgs/${config.orgName}/teams`, { secret: "token" })
    const teams = teamsRaw as GiteaTeam[]

    const team = findTeamByName(teams, teamName)
    if (!team) {
      return yield* new PluginError({
        message: `Team '${teamName}' not found in org '${config.orgName}'. Create it first via Gitea admin UI or setup job.`,
      })
    }

    yield* svc.http.put(
      `${config.giteaUrl}/api/v1/teams/${team.id}/members/${ctx.principal.externalId}`,
      {},
      { secret: "token" },
    )

    yield* svc.log("Gitea team member added", {
      team: teamName,
      teamId: team.id,
      username: ctx.principal.externalId,
    })
  })

const deprovision = (ctx: GrantContext, svc: PluginServices) =>
  Effect.gen(function* () {
    const config = ctx.config as GiteaTeamsConfig
    const teamName = resolveTeamName(config, ctx.role.slug)
    if (!teamName) return

    if (!ctx.principal.externalId) {
      return yield* new PluginError({
        message: `Principal ${ctx.principal.id} has no externalId`,
      })
    }

    const teamsRaw = yield* svc.http.get(`${config.giteaUrl}/api/v1/orgs/${config.orgName}/teams`, { secret: "token" })
    const teams = teamsRaw as GiteaTeam[]

    const team = findTeamByName(teams, teamName)
    if (!team) {
      yield* svc.log(`Team '${teamName}' not found, skipping deprovision`)
      return
    }

    yield* svc.http.del(`${config.giteaUrl}/api/v1/teams/${team.id}/members/${ctx.principal.externalId}`, {
      secret: "token",
    })

    yield* svc.log("Gitea team member removed", {
      team: teamName,
      teamId: team.id,
      username: ctx.principal.externalId,
    })
  })

export const giteaTeamsPlugin: Plugin = {
  manifest,
  provisioningTemplates,
  provision,
  deprovision,
}
