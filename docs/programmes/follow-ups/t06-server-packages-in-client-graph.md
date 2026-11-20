+++
type = "task"
mode = "afk"
status = "closed"
blocked_by = []
repos = ["duro-app"]
+++

# Why the client graph pulls server-only packages

## Question

Before the t01 fix, the browser's import graph made vite find `jose`,
`nodemailer`, `node-forge`, `@effect/sql-pg/PgClient`, `openid-client`
and `@react-email/render` as client dependencies. Which client module
imports them, and what keeps them out of the browser bundle?

## Look at

- `node_modules/.vite/deps/_metadata.json` after a cold start, and the
  scan's `vite:deps` debug output.
- Modules under `app/lib/` without `.server` that routes import.

## Answer looks like

The importing chain, a fix that keeps server packages out of the
client graph, and the production client bundle checked for them.

## Resolution

Task, 2026-11-20. Answered on `fix/server-deps-client-scan`; no code
change, a comment beside `unstable_optimizeDeps`.

- **The premise is off.** The browser's import graph never holds these
  packages: the client `/app/root.tsx` imports no `.server` module (the
  route transform strips `loader`/`action` first). What holds them is
  vite's pre-bundled set, `node_modules/.vite/deps/_metadata.json`.
- **Chain.** The scan crawls whole route modules, and react-router's
  `react-router:dot-server` guard returns early for a scan
  (`options?.scan === true`). So `app/root.tsx`'s loader leads to
  `~/lib/session.server` (jose) and `~/lib/runtime.server` →
  `services/AppLayer.server` → `EmailService.server` (nodemailer,
  `@react-email/render`, `lib/emails/*` → `@duro-app/ui-email`),
  `VaultPki.server` (node-forge), `OidcClient.server` (openid-client),
  `db/client.server` (`@effect/sql-pg/PgClient`, `db/pglite-pool` →
  `@electric-sql/pglite`), `telemetry.server`
  (`@effect/opentelemetry/Otlp`).
- **Why they must stay pre-bundled.** On an SSR request, react-router's
  dev CSS collector (`getStylesForFiles` → `findDeps`) walks the SSR
  graph through vite 6's mixed `moduleGraph.getModuleByUrl`, which
  resolves each URL in the client environment, and the client resolver
  registers every bare import it meets as a missing client dependency.
- **Experiment.** An esbuild plugin in `optimizeDeps.esbuildOptions`
  marking `.server` specifiers external took the start set from 44 to 28
  with all nine server packages gone; the first `/admin` request then
  logged "new dependencies found: … jose, … nodemailer, …" and
  "optimized dependencies changed. reloading", t01's crash path. HEAD's
  config on the same probe: 44 at start, no late discovery. Dropped.
- **Rejected:** an `optimizeDeps.exclude` list of server packages. It
  holds only until someone adds a server package, which brings the crash
  back silently.
- **Production.** `optimizeDeps` never touches `build`. In `build/client`
  0 files carry `ERR_JWT_EXPIRED`, `JWTExpired`, `createTransport`,
  `pkcs12`, `PGlite`, `authorizationCodeGrant`, `PgClient`, `/v1/traces`
  or `renderToReadableStream` (each checked present in its package's own
  `dist`); positive controls: `i18next` in 9 files, `useTranslation` in 49.
- **Filed:** [t11](t11-launch-ignores-dep-reload.md).
