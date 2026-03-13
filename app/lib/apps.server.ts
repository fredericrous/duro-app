import { readFileSync } from "fs"
import { createHash } from "crypto"
import type { AppDefinition } from "./apps"
import { devApps } from "~/mocks/dev-apps"

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

export function getDefaultApps(): AppDefinition[] {
  if (import.meta.env.DEV) return devApps
  return []
}
