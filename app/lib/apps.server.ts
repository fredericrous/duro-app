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
  return apps.filter((app) => app.groups.length === 0 || app.groups.some((group) => userGroups.includes(group)))
}

const devApps: AppDefinition[] = [
  {
    id: "jellyfin",
    name: "Jellyfin",
    url: "http://localhost:8096",
    category: "media",
    icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/></svg>',
    groups: [],
    priority: 1,
  },
  {
    id: "navidrome",
    name: "Navidrome",
    url: "http://localhost:4533",
    category: "media",
    icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>',
    groups: [],
    priority: 2,
  },
  {
    id: "vaultwarden",
    name: "Vaultwarden",
    url: "http://localhost:8080",
    category: "tools",
    icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/></svg>',
    groups: [],
    priority: 1,
  },
]

export function getDefaultApps(): AppDefinition[] {
  if (process.env.NODE_ENV === "development") return devApps
  return []
}
