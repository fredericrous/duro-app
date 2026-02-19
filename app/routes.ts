import { type RouteConfig, index, layout, route } from "@react-router/dev/routes"

export default [
  layout("routes/dashboard.tsx", [
    index("routes/home.tsx"),
    route("admin", "routes/admin.tsx", [index("routes/admin.users.tsx")]),
  ]),
  route("auth/callback", "routes/auth.callback.tsx"),
  route("auth/logout", "routes/auth.logout.tsx"),
  route("health", "routes/health.ts"),
  route("invite/:token", "routes/invite.tsx"),
  route("reinvite/:token", "routes/reinvite.tsx"),
  route("welcome", "routes/welcome.tsx"),
] satisfies RouteConfig
