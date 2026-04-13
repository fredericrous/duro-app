import { Effect } from "effect"
import type { AuditService } from "~/lib/governance/AuditService.server"
import type { ScopedAuditService, PluginManifest } from "../contracts"

type RealAuditService = {
  readonly emit: (event: {
    eventType: string
    actorId?: string
    targetType?: string
    targetId?: string
    applicationId?: string
    metadata?: Record<string, unknown>
    ipAddress?: string
  }) => Effect.Effect<void, unknown>
}

/**
 * Build a scoped audit service for plugin use:
 *  - Automatically tags every event with `source: "plugin:{slug}"`
 *  - Enforces that event types start with "plugin."
 *  - Write-only — plugins cannot query the audit log
 */
export function makeScopedAuditService(real: RealAuditService, manifest: PluginManifest): ScopedAuditService {
  return {
    emit: (event) =>
      real
        .emit({
          eventType: event.eventType.startsWith("plugin.") ? event.eventType : `plugin.${event.eventType}`,
          metadata: {
            ...event.metadata,
            source: `plugin:${manifest.slug}`,
          },
        })
        .pipe(Effect.catchAll(() => Effect.void)),
  }
}
