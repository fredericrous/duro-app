import { Effect } from "effect"
import type { Plugin, GrantContext, PluginServices } from "../../contracts"
import { PluginError } from "../../errors"
import { manifest, type PlexLibrariesConfig } from "./manifest"

const PLEX_TV = "https://plex.tv"
const AUTH = { secret: "plex-token" as const, authHeader: "X-Plex-Token" as const }

interface PlexLibrarySection {
  key: string
  title: string
  type: string
}

interface PlexSharedServer {
  id: number
  machineIdentifier: string
  invitedEmail: string
  username: string
}

const getMachineIdentifier = (svc: PluginServices, config: PlexLibrariesConfig) =>
  Effect.gen(function* () {
    const raw = yield* svc.http.get(`${config.plexUrl}/identity`, AUTH)
    const data = raw as { MediaContainer?: { machineIdentifier?: string } }
    const id = data?.MediaContainer?.machineIdentifier
    if (!id) return yield* new PluginError({ message: "Failed to get Plex machineIdentifier from /identity" })
    return id
  })

const getAllLibrarySectionIds = (svc: PluginServices, config: PlexLibrariesConfig) =>
  Effect.gen(function* () {
    const raw = yield* svc.http.get(`${config.plexUrl}/library/sections`, AUTH)
    const data = raw as { MediaContainer?: { Directory?: PlexLibrarySection[] } }
    const sections = data?.MediaContainer?.Directory ?? []
    if (sections.length === 0) {
      yield* svc.log("plex-libraries: no library sections found")
    }
    return sections.map((s) => parseInt(s.key, 10))
  })

const findSharedServerByEmail = (svc: PluginServices, email: string) =>
  Effect.gen(function* () {
    const raw = yield* svc.http.get(`${PLEX_TV}/api/v2/shared_servers`, AUTH)
    const servers = (Array.isArray(raw) ? raw : []) as PlexSharedServer[]
    return servers.find(
      (s) => s.invitedEmail?.toLowerCase() === email.toLowerCase(),
    ) ?? null
  })

const provision = (ctx: GrantContext, svc: PluginServices) =>
  Effect.gen(function* () {
    const config = ctx.config as PlexLibrariesConfig

    if (!ctx.principal.email) {
      return yield* new PluginError({
        message: `Principal ${ctx.principal.id} has no email — Plex sharing requires an email address`,
      })
    }

    // Check if already shared
    const existingShare = yield* findSharedServerByEmail(svc, ctx.principal.email)
    if (existingShare) {
      yield* svc.log("plex-libraries: user already has a share, skipping invite", {
        email: ctx.principal.email,
        shareId: existingShare.id,
      })
      return
    }

    const machineId = yield* getMachineIdentifier(svc, config)
    const sectionIds = yield* getAllLibrarySectionIds(svc, config)

    yield* svc.http.post(
      `${PLEX_TV}/api/v2/shared_servers`,
      {
        invitedEmail: ctx.principal.email,
        machineIdentifier: machineId,
        librarySectionIds: sectionIds,
        settings: {},
      },
      AUTH,
    )

    yield* svc.log("plex-libraries: invited user and shared all libraries", {
      email: ctx.principal.email,
      libraryCount: sectionIds.length,
    })
  })

const deprovision = (ctx: GrantContext, svc: PluginServices) =>
  Effect.gen(function* () {
    if (!ctx.principal.email) {
      return yield* new PluginError({
        message: `Principal ${ctx.principal.id} has no email`,
      })
    }

    const share = yield* findSharedServerByEmail(svc, ctx.principal.email)
    if (!share) {
      yield* svc.log("plex-libraries: no existing share found, skipping deprovision", {
        email: ctx.principal.email,
      })
      return
    }

    yield* svc.http.del(`${PLEX_TV}/api/v2/shared_servers/${share.id}`, AUTH)

    yield* svc.log("plex-libraries: revoked library sharing", {
      email: ctx.principal.email,
      shareId: share.id,
    })
  })

export const plexLibrariesPlugin: Plugin = {
  manifest,
  provision,
  deprovision,
}
