import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("routes/dashboard.tsx", [
    index("routes/home.tsx"),
    route("users", "routes/users.tsx"),
  ]),
  route("health", "routes/health.ts"),
  route("invite/:token", "routes/invite.tsx"),
  route("welcome", "routes/welcome.tsx"),
] satisfies RouteConfig;
