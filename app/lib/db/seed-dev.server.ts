import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"
import * as crypto from "node:crypto"

/**
 * Development fixtures for the governance tables.
 *
 * Kept out of `migrations/` on purpose: migrations run in production, and a
 * demo catalog must never appear there. This is applied by the in-memory dev
 * layer (`DbDevLive`) and on demand by `npm run seed:dev`, which is how a
 * file-backed dev database (`DURO_DB_PATH`) gets it — that layer runs the real
 * migrations and nothing else.
 *
 * Every insert is `ON CONFLICT DO NOTHING` against the tables' own
 * constraints, so this is safe to re-run: it tops up a database that was
 * seeded before new fixtures were added, rather than being all-or-nothing on
 * an "is it empty" sentinel.
 *
 * ## What the fixtures are shaped to produce
 *
 * `/home` lists an app when AuthzEngine allows the `access` action, which it
 * decides purely on entitlements — `access_mode` does not enter into it. So
 * every app here has an `access` entitlement on its base role, and `dev` holds
 * enough of them for the page to be worth looking at (including the search
 * bar, which only renders once there are apps to filter).
 *
 * `/catalog` derives its badge from `computeState` in apps-catalog.server.ts.
 * The apps below cover all six of its outcomes for `dev`:
 *
 *   open                 grafana         access_mode 'open'
 *   granted_full         nextcloud       grant on every role the app has
 *   granted_can_upgrade  kb-vision       editor but not viewer
 *   pending              immich          an open access_request
 *   requestable          paperless, …    access_mode 'request', nothing held
 *   invite_only          jellyfin        access_mode 'invite_only', nothing held
 */

const PRINCIPALS = [
  { id: "p-dev", type: "user", externalId: "dev", name: "dev", email: "dev@localhost" },
  { id: "p-alice", type: "user", externalId: "alice", name: "Alice", email: "alice@example.com" },
  { id: "p-bob", type: "user", externalId: "bob", name: "Bob", email: "bob@example.com" },
] as const

const GROUPS = [
  { id: "g-family", name: "Family" },
  { id: "g-media", name: "Media" },
] as const

const MEMBERSHIPS = [
  ["g-family", "p-dev"],
  ["g-family", "p-alice"],
  ["g-family", "p-bob"],
  ["g-media", "p-dev"],
  ["g-media", "p-alice"],
] as const

interface SeedRole {
  slug: string
  displayName: string
  /** Entitlement slugs this role conveys, beyond the implicit `access`. */
  entitlements?: string[]
}

interface SeedApp {
  slug: string
  displayName: string
  description: string
  accessMode: "open" | "request" | "invite_only"
  roles: SeedRole[]
}

/**
 * Slugs match `data/apps.json` where one exists, so the home grid picks up the
 * real icon, category and launch URL for these rows instead of rendering them
 * bare (see the staticBySlug lookup in routes/home.tsx).
 */
const APPS: SeedApp[] = [
  {
    slug: "duro",
    displayName: "Duro",
    description: "Access governance platform",
    accessMode: "request",
    roles: [{ slug: "admin", displayName: "Admin", entitlements: ["admin"] }],
  },
  {
    slug: "kb-vision",
    displayName: "KB Vision",
    description: "Knowledge base",
    accessMode: "request",
    roles: [
      { slug: "viewer", displayName: "Viewer", entitlements: ["space.read"] },
      { slug: "editor", displayName: "Editor", entitlements: ["space.read", "space.write"] },
    ],
  },
  {
    slug: "jellyfin",
    displayName: "Jellyfin",
    description: "Media server",
    accessMode: "invite_only",
    roles: [
      { slug: "viewer", displayName: "Viewer", entitlements: ["stream"] },
      { slug: "admin", displayName: "Admin", entitlements: ["stream", "manage_library"] },
    ],
  },
  {
    slug: "grafana",
    displayName: "Grafana",
    description: "Monitoring dashboards",
    accessMode: "open",
    roles: [{ slug: "editor", displayName: "Editor", entitlements: ["dashboard.view", "dashboard.edit"] }],
  },
  {
    slug: "nextcloud",
    displayName: "Nextcloud",
    description: "Files, calendar and contacts",
    accessMode: "request",
    roles: [{ slug: "user", displayName: "User", entitlements: ["files.read", "files.write"] }],
  },
  {
    slug: "immich",
    displayName: "Immich",
    description: "Photo and video library",
    accessMode: "request",
    roles: [
      { slug: "viewer", displayName: "Viewer", entitlements: ["library.read"] },
      { slug: "editor", displayName: "Editor", entitlements: ["library.read", "library.write"] },
    ],
  },
  {
    slug: "paperless",
    displayName: "Paperless",
    description: "Document archive and OCR",
    accessMode: "request",
    roles: [{ slug: "viewer", displayName: "Viewer", entitlements: ["document.read"] }],
  },
  {
    slug: "vaultwarden",
    displayName: "Vaultwarden",
    description: "Password manager",
    accessMode: "request",
    roles: [{ slug: "user", displayName: "User", entitlements: ["vault.use"] }],
  },
  {
    slug: "home-assistant",
    displayName: "Home Assistant",
    description: "Home automation",
    accessMode: "request",
    roles: [
      { slug: "user", displayName: "User", entitlements: ["device.control"] },
      { slug: "admin", displayName: "Admin", entitlements: ["device.control", "device.manage"] },
    ],
  },
  {
    slug: "gitea",
    displayName: "Gitea",
    description: "Git hosting and CI",
    accessMode: "request",
    roles: [{ slug: "developer", displayName: "Developer", entitlements: ["repo.read", "repo.write"] }],
  },
  {
    slug: "audiobookshelf",
    displayName: "Audiobookshelf",
    description: "Audiobooks and podcasts",
    accessMode: "request",
    roles: [{ slug: "listener", displayName: "Listener", entitlements: ["library.listen"] }],
  },
  {
    slug: "uptime-kuma",
    displayName: "Uptime Kuma",
    description: "Service uptime monitoring",
    accessMode: "request",
    roles: [{ slug: "viewer", displayName: "Viewer", entitlements: ["status.read"] }],
  },
]

/** principal → `<appSlug>:<roleSlug>`, plus why, for the grants table. */
const GRANTS: Array<{ id: string; principal: string; target: string; reason: string }> = [
  { id: "grant-dev-duro", principal: "p-dev", target: "duro:admin", reason: "bootstrap" },
  // Not every role on kb-vision → granted_can_upgrade.
  { id: "grant-dev-kb", principal: "p-dev", target: "kb-vision:editor", reason: "bootstrap" },
  // The app's only role → granted_full.
  { id: "grant-dev-nextcloud", principal: "p-dev", target: "nextcloud:user", reason: "bootstrap" },
  { id: "grant-dev-grafana", principal: "p-dev", target: "grafana:editor", reason: "bootstrap" },
  { id: "grant-dev-abs", principal: "p-dev", target: "audiobookshelf:listener", reason: "bootstrap" },
  { id: "grant-dev-kuma", principal: "p-dev", target: "uptime-kuma:viewer", reason: "bootstrap" },
  // Group grant: alice and bob inherit viewer on kb-vision through Family.
  { id: "grant-family-kb", principal: "g-family", target: "kb-vision:viewer", reason: "group grant" },
  { id: "grant-bob-jf", principal: "p-bob", target: "jellyfin:viewer", reason: "direct grant" },
]

const CERTIFICATES = [
  { user: "dev", email: "dev@localhost", serial: "aa:bb:cc:dd:00:00:00:01" },
  { user: "alice", email: "alice@example.com", serial: "aa:bb:cc:dd:00:00:00:02" },
  { user: "alice", email: "alice@example.com", serial: "aa:bb:cc:dd:00:00:00:04" },
  { user: "alice", email: "alice@example.com", serial: "aa:bb:cc:dd:00:00:00:05" },
  { user: "bob", email: "bob@example.com", serial: "aa:bb:cc:dd:00:00:00:03" },
] as const

/**
 * Ids are resolved from the database rather than assumed.
 *
 * Migration 0025 already registers `duro` with a generated uuid, so inserting
 * our own id for it is a no-op on the slug conflict — and every row that then
 * referenced the id we invented failed the foreign key. Read the id back
 * instead, so fixtures compose with whatever the migrations put there.
 */
const idBySlug = (rows: ReadonlyArray<{ readonly id: string; readonly slug: string }>) =>
  new Map(rows.map((r) => [r.slug, r.id]))

/**
 * Certificates for the three fixture users, so /devices has rows.
 *
 * Ids are derived from the serial rather than random, so re-running does not
 * accumulate duplicates — the serial is the table's unique key.
 */
export const seedDevCertificates = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const now = new Date().toISOString()
    const expires = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString()

    for (const c of CERTIFICATES) {
      const id = `cert-${c.serial.replace(/:/g, "")}`
      yield* sql`
        INSERT INTO user_certificates (id, invite_id, user_id, username, email, serial_number, issued_at, expires_at)
        VALUES (${id}, ${`invite-${id}`}, ${c.user}, ${c.user}, ${c.email}, ${c.serial}, ${now}, ${expires})
        ON CONFLICT DO NOTHING
      `
    }
    yield* Effect.log(`dev seed: ${CERTIFICATES.length} certificates`)
  })

export const seedDevGovernance = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    for (const p of PRINCIPALS) {
      yield* sql`
        INSERT INTO principals (id, principal_type, external_id, display_name, email)
        VALUES (${p.id}, ${p.type}, ${p.externalId}, ${p.name}, ${p.email})
        ON CONFLICT DO NOTHING
      `
    }
    for (const g of GROUPS) {
      yield* sql`
        INSERT INTO principals (id, principal_type, display_name)
        VALUES (${g.id}, 'group', ${g.name})
        ON CONFLICT DO NOTHING
      `
    }
    for (const [groupId, memberId] of MEMBERSHIPS) {
      yield* sql`
        INSERT INTO group_memberships (group_id, member_id)
        VALUES (${groupId}, ${memberId})
        ON CONFLICT DO NOTHING
      `
    }

    const appIds = new Map<string, string>()
    const roleIds = new Map<string, string>()

    for (const app of APPS) {
      yield* sql`
        INSERT INTO applications (slug, display_name, description, access_mode, owner_id)
        VALUES (${app.slug}, ${app.displayName}, ${app.description}, ${app.accessMode}, 'p-dev')
        ON CONFLICT DO NOTHING
      `
      const found = yield* sql`SELECT id FROM applications WHERE slug = ${app.slug}`
      const appId = String(found[0].id)
      appIds.set(app.slug, appId)

      // `access` is what AuthzEngine matches for the home-page visibility
      // check, so every app needs one and every role has to convey it.
      const slugs = new Set<string>(["access"])
      for (const role of app.roles) for (const e of role.entitlements ?? []) slugs.add(e)
      for (const slug of slugs) {
        yield* sql`
          INSERT INTO entitlements (application_id, slug, display_name)
          VALUES (${appId}, ${slug}, ${slug})
          ON CONFLICT DO NOTHING
        `
      }
      const entIds = idBySlug(
        (yield* sql`SELECT id, slug FROM entitlements WHERE application_id = ${appId}`) as ReadonlyArray<{
          id: string
          slug: string
        }>,
      )

      for (const role of app.roles) {
        yield* sql`
          INSERT INTO roles (application_id, slug, display_name)
          VALUES (${appId}, ${role.slug}, ${role.displayName})
          ON CONFLICT DO NOTHING
        `
        const roleRow = yield* sql`SELECT id FROM roles WHERE application_id = ${appId} AND slug = ${role.slug}`
        const rid = String(roleRow[0].id)
        roleIds.set(`${app.slug}:${role.slug}`, rid)

        for (const slug of ["access", ...(role.entitlements ?? [])]) {
          const eid = entIds.get(slug)
          if (!eid) continue
          yield* sql`
            INSERT INTO role_entitlements (role_id, entitlement_id)
            VALUES (${rid}, ${eid})
            ON CONFLICT DO NOTHING
          `
        }
      }
    }

    for (const grant of GRANTS) {
      const rid = roleIds.get(grant.target)
      if (!rid) continue
      yield* sql`
        INSERT INTO grants (id, principal_id, role_id, granted_by, reason)
        VALUES (${grant.id}, ${grant.principal}, ${rid}, 'p-dev', ${grant.reason})
        ON CONFLICT DO NOTHING
      `
    }

    yield* sql`
      INSERT INTO approval_policies (id, application_id, scope_type, mode, rules)
      VALUES ('policy-kb', ${appIds.get("kb-vision")!}, 'application', 'one_of',
              ${JSON.stringify([{ approverType: "app_owner" }])})
      ON CONFLICT DO NOTHING
    `

    // dev's own pending request — this is what puts immich in the `pending`
    // state on /catalog and gives /requests a row to render.
    yield* sql`
      INSERT INTO access_requests (id, requester_id, application_id, role_id, justification, status)
      VALUES ('req-dev-immich-editor', 'p-dev', ${appIds.get("immich")!}, ${roleIds.get("immich:editor")!},
              'Need to organise the shared albums', 'pending')
      ON CONFLICT DO NOTHING
    `
    yield* sql`
      INSERT INTO access_requests (id, requester_id, application_id, role_id, justification, status)
      VALUES ('req-bob-kb-editor', 'p-bob', ${appIds.get("kb-vision")!}, ${roleIds.get("kb-vision:editor")!},
              'Need to edit knowledge base articles', 'pending')
      ON CONFLICT DO NOTHING
    `
    yield* sql`
      INSERT INTO request_approvals (id, request_id, approver_id)
      VALUES ('approval-bob-kb', 'req-bob-kb-editor', 'p-dev')
      ON CONFLICT DO NOTHING
    `

    for (const [id, oidcGroup, principalGroup] of [
      ["gm-family", "family", "g-family"],
      ["gm-media", "media", "g-media"],
    ] as const) {
      yield* sql`
        INSERT INTO group_mappings (id, oidc_group_name, principal_group_id)
        VALUES (${id}, ${oidcGroup}, ${principalGroup})
        ON CONFLICT DO NOTHING
      `
    }
    yield* sql`
      INSERT INTO group_mappings (id, oidc_group_name, role_id, application_id)
      VALUES ('gm-admin', 'lldap_admin', ${roleIds.get("duro:admin")!}, ${appIds.get("duro")!})
      ON CONFLICT DO NOTHING
    `

    // Fixed key so local CLI/MCP calls have something to authenticate with.
    // Dev-only by construction: it is in the repo, so it is public.
    const devApiKey = "duro_dev_test_key_0000000000000000"
    const keyHash = crypto.createHash("sha256").update(devApiKey).digest("hex")
    yield* sql`
      INSERT INTO api_keys (id, principal_id, key_hash, key_preview, name, scopes)
      VALUES ('apikey-dev', 'p-dev', ${keyHash}, ${`duro_${devApiKey.slice(5, 9)}\u2026${devApiKey.slice(-4)}`},
              'Dev Test Key', ${JSON.stringify(["*"])})
      ON CONFLICT DO NOTHING
    `

    const roleCount = APPS.reduce((n, a) => n + a.roles.length, 0)
    yield* Effect.log(`dev seed: ${APPS.length} apps, ${roleCount} roles, ${GRANTS.length} grants, 2 pending requests`)
  })

/** Both halves, in FK order. */
export const seedDevFixtures = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    yield* seedDevGovernance(sql)
    yield* seedDevCertificates(sql)
  })
