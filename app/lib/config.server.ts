export const config = {
  appName: process.env.APP_NAME ?? "Daddyshome",
  allowedOriginSuffix: process.env.ALLOWED_ORIGIN_SUFFIX ?? "daddyshome.fr",
  homeUrl: process.env.HOME_URL ?? "https://home.daddyshome.fr",
  inviteBaseUrl: process.env.INVITE_BASE_URL ?? "https://join.daddyshome.fr",
  adminGroupName: process.env.ADMIN_GROUP_NAME ?? "lldap_admin",
  isSystemUser: (username: string) => username === "admin" || username.endsWith("-service"),
  appDescription: process.env.APP_DESCRIPTION ?? "a private platform for media, productivity, and more",
  categoryOrder: (process.env.CATEGORY_ORDER ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
} as const
