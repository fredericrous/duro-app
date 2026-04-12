import { Effect, Schedule } from "effect"
import type { LldapClient } from "~/lib/services/LldapClient.server"
import type { ScopedLldapClient, PluginManifest } from "../contracts"
import { ScopeViolation } from "../errors"

type RealLldapClient = {
  readonly getGroups: Effect.Effect<Array<{ id: number; displayName: string }>, unknown>
  readonly addUserToGroup: (userId: string, groupId: number) => Effect.Effect<void, unknown>
  readonly removeUserFromGroup: (userId: string, groupId: number) => Effect.Effect<void, unknown>
  readonly ensureGroup: (displayName: string) => Effect.Effect<number, unknown>
}

const retrySchedule = Schedule.exponential("200 millis").pipe(Schedule.intersect(Schedule.recurs(3)))

function matchesGlob(pattern: string, value: string): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith("*")) {
    return value.startsWith(pattern.slice(0, -1))
  }
  return pattern === value
}

/**
 * Build a scoped LLDAP client that restricts group operations to those
 * matching the plugin's declared ownership patterns. The patterns are resolved
 * against the plugin's per-install config at construction time.
 */
export function makeScopedLldapClient(
  real: RealLldapClient,
  manifest: PluginManifest,
  config: Record<string, unknown>,
): ScopedLldapClient {
  // Resolve manifest's ownedLldapGroups patterns against config values.
  // e.g. "${config.viewerGroup}" becomes "nextcloud-user" for this install.
  const resolvedPatterns: string[] = manifest.ownedLldapGroups.map((pattern) => {
    if (pattern.startsWith("${config.") && pattern.endsWith("}")) {
      const key = pattern.slice("${config.".length, -1)
      const value = config[key]
      if (typeof value === "string") return value
    }
    return pattern
  })

  const assertGroupAllowed = (groupName: string) => {
    if (resolvedPatterns.some((p) => matchesGlob(p, groupName))) return
    return new ScopeViolation({
      pluginSlug: manifest.slug,
      service: "ScopedLldapClient",
      target: groupName,
      message: `Group '${groupName}' not in plugin's ownedLldapGroups (resolved: [${resolvedPatterns.join(", ")}])`,
    })
  }

  const resolveGroupId = (groupName: string) =>
    real.getGroups.pipe(
      Effect.retry(retrySchedule),
      Effect.map((groups) => groups.find((g) => g.displayName === groupName) ?? null),
    )

  return {
    addUserToGroup: (userId, groupName) =>
      Effect.gen(function* () {
        const violation = assertGroupAllowed(groupName)
        if (violation) return yield* violation

        // Ensure the group exists (lazy creation for the provision path)
        const groupId = yield* real.ensureGroup(groupName).pipe(Effect.retry(retrySchedule))
        yield* real.addUserToGroup(userId, groupId).pipe(Effect.retry(retrySchedule))
      }).pipe(Effect.mapError((e) => (e instanceof ScopeViolation ? e : new ScopeViolation({
        pluginSlug: manifest.slug,
        service: "ScopedLldapClient",
        target: groupName,
        message: `LLDAP addUserToGroup failed: ${e instanceof Error ? e.message : String(e)}`,
      })))),

    removeUserFromGroup: (userId, groupName) =>
      Effect.gen(function* () {
        const violation = assertGroupAllowed(groupName)
        if (violation) return yield* violation

        // Lookup only — don't create a group just to remove someone from it
        const group = yield* resolveGroupId(groupName)
        if (!group) {
          yield* Effect.log("ScopedLldapClient removeUserFromGroup: group not found, no-op").pipe(
            Effect.annotateLogs({ pluginSlug: manifest.slug, groupName }),
          )
          return
        }
        yield* real.removeUserFromGroup(userId, group.id).pipe(Effect.retry(retrySchedule))
      }).pipe(Effect.mapError((e) => (e instanceof ScopeViolation ? e : new ScopeViolation({
        pluginSlug: manifest.slug,
        service: "ScopedLldapClient",
        target: groupName,
        message: `LLDAP removeUserFromGroup failed: ${e instanceof Error ? e.message : String(e)}`,
      })))),

    findGroupByName: (groupName) =>
      Effect.gen(function* () {
        const violation = assertGroupAllowed(groupName)
        if (violation) return yield* violation
        return yield* resolveGroupId(groupName)
      }).pipe(Effect.mapError((e) => (e instanceof ScopeViolation ? e : new ScopeViolation({
        pluginSlug: manifest.slug,
        service: "ScopedLldapClient",
        target: groupName,
        message: `LLDAP findGroupByName failed: ${e instanceof Error ? e.message : String(e)}`,
      })))),
  }
}
