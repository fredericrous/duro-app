+++
type = "task"
mode = "afk"
status = "open"
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
