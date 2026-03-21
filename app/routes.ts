import { type RouteConfig, index, layout, route } from "@react-router/dev/routes"

export default [
  layout("routes/dashboard.tsx", [
    index("routes/home.tsx"),
    route("settings", "routes/settings.tsx"),
    route("admin", "routes/admin.tsx", [
      index("routes/admin.invites.tsx"),
      route("users", "routes/admin.users.tsx"),
    ]),
  ]),
  route("auth/callback", "routes/auth.callback.tsx"),
  route("auth/logout", "routes/auth.logout.ts"),
  route("health", "routes/health.ts"),
  route("invite/:token", "routes/invite.tsx"),
  route("invite/:token/create-account", "routes/invite-create-account.tsx"),
  route("reinvite/:token", "routes/reinvite.tsx"),
  route("welcome", "routes/welcome.tsx"),
  route("api/bootstrap-invite", "routes/api.bootstrap-invite.ts"),
  route("admin/me", "routes/api.admin-me.ts"),
  route("admin/invites", "routes/api.admin-invites.ts"),
  route("admin/users-data", "routes/api.admin-users-data.ts"),
] satisfies RouteConfig
