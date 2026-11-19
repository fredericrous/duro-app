+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
repos = ["duro-app"]
+++

# Why the dev seed shows two Family groups

## Question

`/admin/identities` in dev lists Family twice: `/admin/principals/grp-family`
(migration `0026_seed_app_access.ts`) and `/admin/principals/g-family`
(`seed-dev.server.ts`). Is it only the dev seed, or does production hold
two Family principals too?

## Look at

- `app/lib/db/migrations/pg/0026_seed_app_access.ts` and
  `app/lib/db/seed-dev.server.ts`.
- The production principals table (read-only query).

## Answer looks like

Either a dev-seed fix that uses the migration's id, or a migration that
merges the two, with its grants.
