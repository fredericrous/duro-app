import { readFileSync } from "fs"
import { createHash } from "crypto"
import type { AppDefinition } from "./apps"

const APPS_JSON_PATH = "/data/apps.json"

let cachedApps: AppDefinition[] | null = null
let cachedHash: string = ""

export function loadApps(): AppDefinition[] {
  try {
    const raw = readFileSync(APPS_JSON_PATH, "utf-8")
    const hash = createHash("sha256").update(raw).digest("hex")

    if (cachedApps && hash === cachedHash) {
      return cachedApps
    }

    cachedApps = JSON.parse(raw) as AppDefinition[]
    cachedHash = hash
    return cachedApps
  } catch {
    return getDefaultApps()
  }
}

export function getVisibleApps(userGroups: string[]): AppDefinition[] {
  const apps = loadApps()
  return apps.filter((app) => app.groups.some((group) => userGroups.includes(group)))
}

export function getDefaultApps(): AppDefinition[] {
  return [
    {
      id: "plex",
      name: "Plex",
      url: "https://plex.daddyshome.fr",
      category: "media",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0L1.5 6v12L12 24l10.5-6V6L12 0zm0 2.5l8 4.6v9.8l-8 4.6-8-4.6V7.1l8-4.6z"/><path d="M12 5L6 8.5v7L12 19l6-3.5v-7L12 5z"/></svg>',
      groups: ["friends", "family", "lldap_admin"],
      priority: 10,
    },
    {
      id: "stremio",
      name: "Stremio",
      url: "https://stremio.daddyshome.fr",
      category: "media",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><polygon points="10,8 16,12 10,16" fill="currentColor"/></svg>',
      groups: ["friends", "family", "lldap_admin"],
      priority: 20,
    },
    {
      id: "kyoo",
      name: "Kyoo",
      url: "https://kyoo.daddyshome.fr",
      category: "media",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 9l5 3-5 3V9z" fill="currentColor"/></svg>',
      groups: ["friends", "family", "lldap_admin"],
      priority: 30,
    },
    {
      id: "openwebui",
      name: "OpenWebUI",
      url: "https://ai.daddyshome.fr",
      category: "ai",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
      groups: ["friends", "family", "lldap_admin"],
      priority: 10,
    },
    {
      id: "nextcloud",
      name: "Nextcloud",
      url: "https://drive.daddyshome.fr",
      category: "productivity",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="5" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="19" cy="12" r="2.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
      groups: ["family", "lldap_admin"],
      priority: 10,
    },
    {
      id: "immich",
      name: "Immich",
      url: "https://photos.daddyshome.fr",
      category: "productivity",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
      groups: ["family", "lldap_admin"],
      priority: 20,
    },
    {
      id: "lldap",
      name: "LLDAP",
      url: "https://lldap.daddyshome.fr",
      category: "admin",
      icon: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="7" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" stroke="currentColor" stroke-width="2" fill="none"/><circle cx="17" cy="7" r="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M21 21v-2a3 3 0 0 0-3-3h-1" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
      groups: ["lldap_admin"],
      priority: 10,
    },
  ]
}
