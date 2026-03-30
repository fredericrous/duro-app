const isDevServer = process.env.NODE_ENV === "development" && process.env.VITEST !== "true"

export const config = {
  appName: process.env.APP_NAME ?? (isDevServer ? "Duro" : "Daddyshome"),
  allowedOriginSuffix: process.env.ALLOWED_ORIGIN_SUFFIX ?? (isDevServer ? "localhost" : "daddyshome.fr"),
  homeUrl: process.env.HOME_URL ?? "https://home.daddyshome.fr",
  inviteBaseUrl: process.env.INVITE_BASE_URL ?? "https://join.daddyshome.fr",
  adminGroupName: process.env.ADMIN_GROUP_NAME ?? "lldap_admin",
  isSystemUser: (username: string) => username === "admin" || username.endsWith("-service"),
  appDescription: process.env.APP_DESCRIPTION ?? "a private platform for media, productivity, and more",
  categoryOrder: (process.env.CATEGORY_ORDER ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  operatorApiUrl: process.env.OPERATOR_API_URL ?? "",
} as const

/** Check if a request Origin header matches the allowed suffix. */
export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return true
  try {
    return new URL(origin).hostname.endsWith(config.allowedOriginSuffix)
  } catch {
    return false
  }
}
