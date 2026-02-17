import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("health", "routes/health.ts"),
  route("users", "routes/users.tsx"),
  route("invite/:token", "routes/invite.tsx"),
  route("welcome", "routes/welcome.tsx"),
  route("api/process-invite", "routes/api.process-invite.ts"),
] satisfies RouteConfig;
