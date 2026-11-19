import type { Config } from "@react-router/dev/config"

export default {
  ssr: true,
  future: {
    // Hands vite's dependency scan the client entry and every route module
    // from routes.ts. Without it the scan has no entries, only React is
    // pre-bundled at startup, and the first browser visit to a route finds
    // the rest (@duro-app/ui, react-i18next, effect, …): vite re-bundles,
    // the page already holds the old React, and it crashes once with
    // "Invalid hook call" until a reload. Needs the `loader: "jsx"` on the
    // babel rules in vite.config.ts, or the scan fails on every component.
    unstable_optimizeDeps: true,
  },
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
