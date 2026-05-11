import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Re-classify existing apps' access_mode.
 *
 * History: `ApplicationRepo.create()` defaults `accessMode` to `invite_only`,
 * which is the safest default but the wrong fit for a homelab where most
 * apps should be self-requestable (user submits, admin approves). This
 * migration flips the dial: every app becomes `request` *except* a small
 * allowlist of admin-grade or sensitive services that stay `invite_only`.
 *
 * Both UPDATEs are idempotent — re-running this migration is a no-op once
 * the data is already in the target state.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // Apps that must remain invite-only. Admin-category services + a few
  // specific apps the owner doesn't want users to self-request.
  // Slugs are lowercase-kebab-case to match what AppSyncService writes
  // (the operator's app `id` is used as the slug verbatim).
  //
  // Adjust this list and re-deploy to bring a new app into the locked set;
  // for one-offs, prefer toggling via /admin/applications/$id rather than
  // editing the migration.
  yield* sql`
    UPDATE applications
    SET access_mode = 'invite_only', updated_at = NOW()
    WHERE slug IN (
      'cluster-vision', 'flux', 'authelia', 'radarr', 'sonarr',
      'qbittorrent', 'lldap', 'ddns-updater', 'prowlarr', 'grafana',
      'garage'
    )
      AND access_mode != 'invite_only'
  `

  // Everything else becomes 'request' — users can self-submit, admin
  // approves. The `slug NOT IN (...)` mirrors the list above so the two
  // statements partition the table cleanly.
  yield* sql`
    UPDATE applications
    SET access_mode = 'request', updated_at = NOW()
    WHERE slug NOT IN (
      'cluster-vision', 'flux', 'authelia', 'radarr', 'sonarr',
      'qbittorrent', 'lldap', 'ddns-updater', 'prowlarr', 'grafana',
      'garage'
    )
      AND access_mode != 'request'
  `
})
