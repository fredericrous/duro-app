+++
type = "task"
mode = "afk"
status = "closed"
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

## Resolution

Task, 2026-11-20. Fixed on `fix/dev-seed-one-family`; dev seed only.

- **Production holds one Family.** A read-only query on the
  `postgres-apps` replica lists two group principals, `grp-family` and
  `grp-friends`; `group_mappings` maps `family` → `grp-family`, which
  holds the 6 `access` grants from 0026. No `g-family` row exists, so
  no merge migration is needed.
- **Why dev had two.** `seed-dev.server.ts` predates 0026 and created
  its own `g-family`. The dev layer runs migrations first, so 0026 added
  `grp-family` and its `family` mapping; the seed's `gm-family` mapping
  then hit the `oidc_group_name` unique key and was dropped silently.
  dev, alice and bob sat in a Family that no OIDC group fed.
- **Fix.** The seed uses `grp-family` for its memberships and the
  kb-vision group grant, and no longer maps `family` itself. Checked by
  booting `DbDevLive`: one Family (`grp-family`) holding dev, alice and
  bob plus `grant-family-kb`; no `g-family`.
- **Gap.** A file-backed dev database (`DURO_DB_PATH`) seeded before
  this keeps its `g-family` row: the seed only inserts. Delete it there
  by hand, or start a fresh store.
