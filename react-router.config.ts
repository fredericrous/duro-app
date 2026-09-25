import type { Config } from "@react-router/dev/config"

export default {
  ssr: true,
  // react-router 7.18.3+ refuses an action whose Origin differs from
  // request.url's origin, scheme included. TLS ends at the gateway, so the pod
  // builds `http://home.daddyshome.fr/...` while the browser sends
  // `Origin: https://home.daddyshome.fr`: every form post would be a 400.
  // Naming the public hosts forgives only that scheme difference; any other
  // origin is still refused. Read at build time; override with
  // ALLOWED_ACTION_ORIGINS (comma-separated) for another deployment.
  allowedActionOrigins: (process.env.ALLOWED_ACTION_ORIGINS ?? "home.daddyshome.fr,join.daddyshome.fr")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
} satisfies Config
