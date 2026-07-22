import * as SqlClient from "@effect/sql/SqlClient"
import { Effect } from "effect"

/**
 * Give catalog apps a real one-line description + an official homepage so
 * requesters can tell what they're asking for. Two problems this fixes:
 *  - `applications.description` was seeded with the *category* word ("media",
 *    "admin", …) — useless as a description. We overwrite it, but ONLY when it
 *    still equals that category placeholder (or is null), so a real admin edit
 *    is never clobbered.
 *  - `applications.url` is the app's *launch* URL (shown once you have access),
 *    not a "what is this" page. New `homepage` column holds the official site.
 *
 * Descriptions are written for the well-known apps; a few bespoke/uncertain
 * ones (duro, kb-vision, cluster-vision, openclaw) are left as-is for the admin
 * to fill. Homepages are set only where the official URL is unambiguous.
 */
const APP_INFO: ReadonlyArray<{
  slug: string
  old: string
  description: string
  homepage: string | null
}> = [
  {
    slug: "authelia",
    old: "admin",
    description: "Single sign-on & two-factor authentication portal",
    homepage: "https://www.authelia.com",
  },
  {
    slug: "cluster-vision",
    old: "admin",
    description: "Kubernetes cluster health & workload overview",
    homepage: null,
  },
  {
    slug: "code-server",
    old: "development",
    description: "VS Code in your browser",
    homepage: "https://github.com/coder/code-server",
  },
  {
    slug: "ddns-updater",
    old: "admin",
    description: "Keeps your dynamic DNS records up to date",
    homepage: "https://github.com/qdm12/ddns-updater",
  },
  {
    slug: "flux",
    old: "admin",
    description: "GitOps continuous delivery for Kubernetes",
    homepage: "https://fluxcd.io",
  },
  {
    slug: "garage-webui",
    old: "admin",
    description: "Web console for Garage S3-compatible object storage",
    homepage: "https://garagehq.deuxfleurs.fr",
  },
  {
    slug: "gitea",
    old: "development",
    description: "Self-hosted Git service for your code",
    homepage: "https://about.gitea.com",
  },
  {
    slug: "grafana",
    old: "admin",
    description: "Dashboards for metrics & monitoring",
    homepage: "https://grafana.com",
  },
  { slug: "immich", old: "storage", description: "Self-hosted photo & video backup", homepage: "https://immich.app" },
  {
    slug: "kavita",
    old: "media",
    description: "Library for comics, manga & e-books",
    homepage: "https://www.kavitareader.com",
  },
  {
    slug: "kyoo",
    old: "media",
    description: "Movie & TV streaming server",
    homepage: "https://github.com/zoriya/Kyoo",
  },
  {
    slug: "lldap",
    old: "admin",
    description: "Lightweight directory for user accounts & groups",
    homepage: "https://github.com/lldap/lldap",
  },
  {
    slug: "n8n",
    old: "automation",
    description: "Build automated workflows between your apps",
    homepage: "https://n8n.io",
  },
  {
    slug: "navidrome",
    old: "media",
    description: "Stream your personal music collection",
    homepage: "https://www.navidrome.org",
  },
  {
    slug: "nextcloud",
    old: "storage",
    description: "Files, calendar & contacts you host yourself",
    homepage: "https://nextcloud.com",
  },
  {
    slug: "openwebui",
    old: "ai",
    description: "Chat interface for local AI models",
    homepage: "https://openwebui.com",
  },
  {
    slug: "paperless",
    old: "productivity",
    description: "Scan, OCR & archive your documents",
    homepage: "https://docs.paperless-ngx.com",
  },
  {
    slug: "paperless-gpt",
    old: "productivity",
    description: "AI-assisted tagging for Paperless",
    homepage: "https://github.com/icereed/paperless-gpt",
  },
  {
    slug: "plex",
    old: "media",
    description: "Stream your movies, TV & music library",
    homepage: "https://www.plex.tv",
  },
  {
    slug: "prowlarr",
    old: "automation",
    description: "Indexer manager for Sonarr & Radarr",
    homepage: "https://prowlarr.com",
  },
  {
    slug: "qbittorrent",
    old: "automation",
    description: "BitTorrent download client",
    homepage: "https://www.qbittorrent.org",
  },
  {
    slug: "radarr",
    old: "automation",
    description: "Automatically find & download movies",
    homepage: "https://radarr.video",
  },
  { slug: "seerr", old: "media", description: "Request movies & TV shows to be added", homepage: null },
  { slug: "social-planner", old: "automation", description: "Plan & schedule social-media posts", homepage: null },
  {
    slug: "sonarr",
    old: "automation",
    description: "Automatically find & download TV series",
    homepage: "https://sonarr.tv",
  },
  { slug: "stalwart", old: "admin", description: "Self-hosted mail server (email)", homepage: "https://stalw.art" },
  {
    slug: "stremio",
    old: "media",
    description: "Stream movies & shows from many sources",
    homepage: "https://www.stremio.com",
  },
]

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`ALTER TABLE applications ADD COLUMN IF NOT EXISTS homepage TEXT`

  for (const info of APP_INFO) {
    // Replace the category-placeholder description only — never a real edit.
    yield* sql`UPDATE applications SET description = ${info.description}
               WHERE slug = ${info.slug} AND (description IS NULL OR description = ${info.old})`
    if (info.homepage) {
      yield* sql`UPDATE applications SET homepage = ${info.homepage}
                 WHERE slug = ${info.slug} AND homepage IS NULL`
    }
  }
})
