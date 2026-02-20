export const config = {
  appName: process.env.APP_NAME ?? "Daddyshome",
  allowedOriginSuffix: process.env.ALLOWED_ORIGIN_SUFFIX ?? "daddyshome.fr",
  homeUrl: process.env.HOME_URL ?? "https://home.daddyshome.fr",
  inviteBaseUrl: process.env.INVITE_BASE_URL ?? "https://join.daddyshome.fr",
  adminGroupName: process.env.ADMIN_GROUP_NAME ?? "lldap_admin",
  systemUsers: (process.env.SYSTEM_USERS ?? "admin,gitea-service").split(",").map((s) => s.trim()),
  appDescription: process.env.APP_DESCRIPTION ?? "a private platform for media, productivity, and more",
} as const
