---
status: active
branch: chore/greenrack
repos: [duro-app, homelab, decisions]
adrs: [ADR-0075, ADR-0076]
plan-id: p-01M7YXKXV25CK4BPZ2TYF2YRX3
---

# Sweep duro-app onto greenrack

## Review panel

👉 **Decide:** none — approve if a no-UI-change sweep to greenrack 7.2.1, checked per commit on a fresh production build with a full route crawl, is enough before v1.65.0.
📍 duro-app, homelab, decisions · 6 phases · 1 release · 1 step for you · next: Baseline in `duro-app-wt-greenrack`. Panel: backend, lang:typescript, platform, react, tui, ui-design, unix (opus-5-5), codex.
**Changed by review:**

- The crawl sets the theme by cookie, asserts `data-theme`, reaches focus-visible by Tab, and covers empty, invalid, disabled and overlay-focus states.
- Each commit gets a fresh build; audit JSON, print-config and `compare` exits are read, never piped blind; the sweep's leftovers are diffed against a named list.
- Phase 4 saves a 1.64.0 ERROR baseline first and checks `history[0]`, the image tag and each chart step.
  📄 Full reviews: [2026-11-21-sweep-duro-app-onto-greenrack.reviews.md](2026-11-21-sweep-duro-app-onto-greenrack.reviews.md)
  **Verdicts:** round 1 7 approve-with-changes; round 2 4 approve, 3 approve-with-changes; codex approve-with-changes, its 2 highs applied and backend re-bound; 11 carried; words 2314 → 2742 (×1.18); remove 0, merge 0 (2+3 ruled no merge: it would lose the bisect point).

## Picture

```
 v1.64.0 (live 10:45Z) = 4dab250; main 3d7ab22 adds the chart bump
   |
   |  chore/greenrack, one PR, merge commit (bisectable)
   |  commit 1             commit 2             commit 3
   |  ui/tokens/ui-email   ui/tokens/ui-email   greenrack 7.2.1:
   |  5.9 -> 5.45  ------> 5.45 -> 6.3  ------> new names, tokens
   |  (eslint stays 6.0)   + eslint pair 6.3    regex, postcss path,
   |                       + doctor @^6         hooks, skills, doctor
   v
 v1.65.0 = v1.64.0 + the sweep -> ghcr image + chart (zot mirror)
        -> homelab pin -> duro + duro-worker roll (home. and join.)
```

Three bisectable commits on one PR, released as v1.65.0 with nothing else in
it, so a fault in 1.65.0 points at the sweep alone.

## Context

Programme greenrack-rename, ticket t08 (decisions
`docs/programmes/greenrack-rename/t08-fleet-sweep.md`, "duro-app: main
released first"). duro-app is the next t08 app after application-landscape.
It compiles tokens from source, so activity-vision's plan is the template
(`activity-vision:docs/plans/2026-11-19-sweep-activity-vision-onto-greenrack.md`);
it is pnpm, so the lock recipe and audit come from application-landscape's plan
(`application-landscape:docs/plans/2026-11-20-sweep-application-landscape-onto-greenrack.md`).

**Release scope.** v1.64.0 is `4dab250`; origin/main `3d7ab22` adds only the
`[skip ci]` chart bump (checked 2026-11-21). No main-first phase.

duro-app today (read 2026-11-21 on 4dab250/3d7ab22):

- **pnpm 10.30.2**, `pnpm-lock.yaml`; `.npmrc`'s `legacy-peer-deps` is not
  read by pnpm. GitHub Actions (`ci.yml`: build + SSR smoke, typecheck,
  format:check, `pnpm run lint` = `eslint app/`, vitest in 2 shards,
  integration with LLDAP); `release.yml` builds the ghcr image.
- **Versions.** `@duro-app/ui`, `-tokens`, `-ui-email` `^5.9.0` (lock 5.9.0);
  `-eslint-config` and `-eslint-plugin` `^6.0.0`; `@aval-adr/eslint-config`
  `^0.16.0` already direct; `eslint.config.js` already takes `react` from the
  DS and `effect`, `tests`, `adrLint()` from `@aval-adr` (the 6.x split is
  done). 5.45 and 6.3 exist for all three runtime packages;
  `@greenharness/greenrack-ui-email` 7.2.1 exists; greenrack is at **7.2.1**.
- **Tokens compiled from source.** `vite.config.ts` babel rule
  `/node_modules\/@duro-app\/tokens\/.*\.[jt]sx?$/` (the `npm-name-escaped`
  row) and `ssr.noExternal: [..., "@duro-app/tokens"]`; `postcss.config.js`
  includes `node_modules/@duro-app/tokens/src/**/*.{ts,tsx}` (`npm-name` row),
  which is what turns `breakpoints.md` into a literal `@media` (else the rail
  never appears). About 50 app files deep-import `@duro-app/tokens/tokens/*`.
- **Theme.** `root.tsx` feeds an explicit `theme` (cookie `__duro_theme`,
  default dark; `system` follows `prefers-color-scheme`) to both
  `html[data-theme]` and `<ThemeProvider theme>`. `app/styles/global.css`
  hard-codes values that mirror the DS dark/light tokens. The cookie names
  name the app and stay.
- **Emails.** `app/lib/emails/**` use `@duro-app/ui-email`;
  `emails.test.tsx` asserts rendered colours and a `.d-btn` dark-mode class.
- **Hooks/skills.** `.claude/hooks/duro-catalog.sh`, `duro-plan.sh` beside
  `aval-heads.sh`; skills `duro-mockup`, `colors`, `typography`, `ui`
  (generated, listed in `.prettierignore`) and `verify-duro-app` (the repo's
  own). `.gitignore` keeps `.claude/.duro-session.cache*`.
- **Doctor row.** `greengate.conf` `duro-doctor` runs
  `npx -y @duro-app/cli@^5.4.0 doctor`; the sed alone would make it
  `greenrack-cli@^5.4.0`, which does not exist: it is a hand edit.
- **Sweep dry run** (`--check`, 3d7ab22, allowlist `docs/plans/**`,
  `docs/mockups/**`, `docs/programmes/**`, `.adr/packs/**`,
  `.claude/skills/**`, `.gitignore`): npm-name 189, npm-name-escaped 1,
  css-var 0, data-attr 1 (CLAUDE.md prose), eslint-rule 11, lexical-pkg 0,
  editor-theme 0. Old names left beyond the rewritable ones: the two
  `duro-*.sh` hooks and their `.claude/settings.json` entries,
  `ui-handoff.yml`'s `/duro-mockup`, `.prettierignore`'s skill paths, CLAUDE.md
  prose, comments in `vite.config.ts`, `postcss.config.js`,
  `react-router.config.ts`, `app/styles/global.css`, `app/test/setup.ts`,
  `ci.yml`, `release.yml`.
- **Serving with dev layers.** `isDevServer` is `NODE_ENV === "development"`
  (`AppLayer.server.ts:45`, `auth.server.ts:26`, `config.server.ts:1`), read
  at runtime, so the production build served with `NODE_ENV=development
pnpm start` gets the dev user, the seeded in-memory PGlite and dev email.
- **Two hosts.** `home.daddyshome.fr` (Authelia) and `join.daddyshome.fr`
  (public invite pages); 58 entries in `app/routes.ts`.
- **Waiver.** GHSA-chp3 waived until 2026-12-19 (f36): v1.65.0 ships before.
- Under host load `app/lib/db/embedded-db.test.ts` (PGlite) times out at
  30 s; heavy steps run through `greengate slot run --max-wait 540`.
- **Merge methods.** merge commit, squash and rebase all allowed.

## Goal

duro-app builds, lints, tests and renders on `@greenharness/greenrack-ui`,
`-tokens`, `-ui-email` ^7.2.1 and the eslint pair pinned at 7.2.1. No
`@duro-app/`, `duro/` rule id or `duro-*` hook/skill name is left outside the
allowlist named in the PR. v1.65.0 runs in the homelab.

## Non-goals

- The app's own name (Duro, `__duro_theme`/`__duro_scheme` cookies,
  `APP_NAME`), the Helm chart and image names.
- The `duro-stack` scope (t12); the mockups (`docs/mockups/**`, allowlisted).
- Any UI change; f36's Effect bump.

## Code review

- duro-app: backend, lang:typescript, react, ui-design, platform, architect
- homelab: none — a one-line chart version pin in `kubernetes/homelab/apps/duro/helm-release.yaml`, no code
- decisions: none — markdown only

## Behaviour

- Every page renders as before, in dark and light (set by the `__duro_theme` cookie; plus `system` under emulated light and dark `prefers-color-scheme` on two pages, asserting `html[data-theme]` matches the ThemeProvider's theme), at 1280 and
  touch-emulated 390 (`pointer: coarse`, `hover: none`), from a crawl built
  from `app/routes.ts`:
  - `home.` pages signed in as the dev admin: home/catalog, settings (+
    security, activity), devices, requests, admin dashboard and every admin
    collection and one detail page each (applications, identities,
    principals, grants (+new), group-mappings, access-requests, invites,
    invitations, audit, plugins, authz playground, recovery, setup);
  - `join.`-style public pages with seeded tokens: invite, invite create
    account, cert reveal, reinvite, recover, welcome, setup; plus an unknown
    path (the error page).
  - The crawl reports coverage: routes in `routes.ts` vs routes visited, each
    skip named with its reason.
- Opened surfaces: the cert panel Drawer at 390, one Dialog
  (QuickGrantDialog), one Select/Combobox popup, the HelpPopover, a toast
  from one admin mutation, focus moving into QuickGrantDialog and the cert Drawer on open and back to the trigger on Escape, the SideNav rail at 1280 and its collapsed form
  at 390.
- Emails: invite, cert renewal and cert-install-steps render to HTML; the
  HTML diff against the previous commit is empty except for named class or
  token renames.
- Claude hooks are `greenrack-catalog.sh` and `greenrack-plan.sh`, one entry
  per event; `aval-heads.sh` untouched.

Expected differences, recorded (not stops), from earlier sweeps: the 5.45
coarse-pointer 44px buttons at 390; SideNav opening the current group
(5.45); a Select popup flipping above its trigger when there is no room
below. Any other measured difference stops the commit and goes to the person.

## Phases

**Rules at every commit.** Lock: reset `pnpm-lock.yaml` to the previous
commit's, set the ranges, `pnpm install`; never `pnpm update --depth
Infinity`. Then: the lock diff moves only DS packages and their new
dependencies (plus `@aval-adr/eslint-config` in a phase that moves it); `grep -qF git.daddyshome.fr pnpm-lock.yaml` exits exactly 1;
`pnpm why react-native` shows nothing new beyond the DS's optional peers.
Audit: `pnpm audit --prod --json > <scratch>/audit-<c>.json` (exit ignored,
never chained, but the JSON must parse and hold the advisories object, else
the phase stops: an error reply is not an empty set) and the same in `scripts/mcp` (`npm audit --omit=dev --json`);
the sorted advisory IDs are a subset of the Baseline's (chp3 only); a new one
stops. `pnpm run typecheck`, `pnpm run lint`, `pnpm run format:check` and
`pnpm test` (through `greengate slot run --max-wait 540`) pass with the
Baseline's test count and no new lint warning.
Each of c1–c3 is checked on its own fresh production build: stop the
previous server, remove `build/`, `pnpm run build`, the SSR smoke, then
serve and run the crawl, served-CSS, email and print-config checks; the
commit sha and lock hash are recorded with each phase's results.

- [x] Phase 0: Baseline, in `duro-app-wt-greenrack` (branch `chore/greenrack`)
      on 3d7ab22, no commit.
  - Build and serve: `pnpm run build`, then
    `NODE_ENV=development ALLOWED_ORIGIN_SUFFIX=127.0.0.1 PORT=<p> pnpm start`
    with the dead-loopback env that `verify-duro-app`'s Launch sets for LLDAP,
    Vault, operator, Forgejo and OTel. If the production build does not start
    with dev layers, stop and fall back to the dev server for the crawl (the
    plan says which was used) and keep the served-CSS checks on the
    production build.
  - Seed the tokens the public pages need (an invite, a reveal token, a
    recovery) through the dev store's own paths (`seed-dev.server.ts`,
    admin actions); the seed script lives in the scratch dir.
  - One fixed Playwright script in the scratch dir, reused unchanged at
    every commit, run by `browser-check` (haiku), with the theme set by the `__duro_theme=dark|light` cookie on the context before the first request and `html[data-theme]` plus the ThemeProvider wrapper's `data-theme` asserted per shot: the Behaviour crawl and
    surfaces; screenshots; computed `background`, `color`, `padding`,
    `gap`, `border` and `font` of AppShell, Header, one Card, one Button
    (with hover, and `:focus-visible` reached by Tab, never `.focus()`, recording `outline` and `box-shadow`), the SideNav item, a table row and an
    input; the a11y tree and Tab order of the admin applications list and the
    invite page; console errors. States: one admin collection emptied through the dev store (its EmptyState), one form submitted invalid (inline error on the input), one disabled Button's computed style; the loading state is recorded as not covered. `compare -metric AE -fuzz 2%` against the
    previous commit's screenshots: the AE count read from stderr; AE 0
    passes, a non-zero page (exit 1) is classified as an expected difference
    or a stop; exit 2 (size mismatch, read error) stops.
  - Served CSS: inventory every `var(--…)` in `build/client/assets/*.css`;
    static tokens all defined (app CSS or the DS dist), StyleX runtime vars
    (`--x-*`) checked by their inline assignment; no
    `@media (min-width: var(` anywhere.
  - Hash probe (scratch dir): compile greenrack-tokens 7.2.1's
    `src/tokens/*.css.ts` twice, through vite.config.ts's tokens-rule options (`dev: true`, `rootDir: process.cwd()`) and through postcss.config.js's (`platform: "web"` only), and grep
    each emitted `--*-x*` name in greenrack-ui 7.2.1's `dist/index.css`;
    expected 0 missing (activity-vision proved it for 7.1.0; repeat for
    7.2.1).
  - Token values: diff every DS custom property the app or `global.css`
    mirrors (and `root.tsx`'s `theme-color` `#0f0f0f`), by resolved value, across 5.9.0, 5.45.0, 6.3.0 and 7.2.1 from the
    tarballs; a changed value is named before commit 1.
  - Emails: render the three templates to HTML files.
  - `eslint --print-config <f> > <scratch>/pc-<c>-<n>.json` (eslint's exit checked: zsh has no pipefail), then `jq -S '.rules'` on that file, which must be a non-empty object, on `app/root.tsx`,
    `app/routes/admin.applications.tsx`, `app/lib/emails/invite-email.tsx`,
    `app/routes/admin.identities.test.tsx`, `app/lib/db/client.server.ts`,
    `scripts/seed-dev.ts`, `scripts/build-worker.mjs`, one `scripts/mcp` file
    and the worker entry. CI lints `app/` only: a change outside `app/` is
    recorded, not a stop.
  - Counts: typecheck, lint warnings, test count, `pnpm why` of the DS and
    eslint packages.
- [x] Phase 1: ui, tokens, ui-email 5.9 → ^5.45.0 under `@duro-app`.
  - Files: `package.json`, `pnpm-lock.yaml`; fallout under `app/**` only where
    a 5.x change requires it, each fix citing the change.
  - The eslint pair stays 6.0; `pnpm why @duro-app/eslint-plugin` shows one
    copy.
  - Commit `chore(deps): Duro 5.45`.
- [x] Phase 2: ui, tokens, ui-email, eslint-config, eslint-plugin → ^6.3.0;
      `@aval-adr/eslint-config` to the version 6.3's peer asks; `pnpm install` prints no unmet-peer warning for it (pnpm 10 only warns, so no other gate catches a mismatch).
  - Files: `package.json`, `pnpm-lock.yaml`, `eslint.config.js` if
    print-config loses a rule, `greengate.conf` (doctor row
    `@duro-app/cli@^6` once `npm view @duro-app/cli@^6 version` returns a version, then `greengate trust` and one run of the row exiting 0), lint fallout under `app/**`.
  - Commit `chore(deps): Duro 6.3`.
- [x] Phase 3: the rename to greenrack 7.2.1.
  - (a) Allowlist in a `mktemp` file outside the tree (the dry run's list).
    From decisions' `docs/programmes/greenrack-rename/`: `./sweep-app.sh
--check --allow <f> <wt>`, then `./sweep-app.sh --allow <f> --expect
npm-name --expect npm-name-escaped --expect data-attr --expect eslint-rule
<wt> > <scratch>/sweep.out 2> <scratch>/sweep.err; rc=$?`. Exit 1 is
    expected only for (b)'s and (d)'s files: `sed -n '/^old names left/,$p' <scratch>/sweep.out | tail -n +2 | cut -d: -f1 | sort -u` is diffed against that named file list, and any other path stops; `<scratch>/sweep.err` must be empty. 2, 3 or 4 stops, and on 3 or 4 (the rewrite may have run) `git -C <wt> checkout -- .` first, so a re-run does not exit 2 on a dirty tree. The before/after
    table and the "old names left" go into the PR, pasted from `sweep.out`
    inside a code fence so the fixed-width columns stay aligned.
  - (b) Hand edits: ranges ^7.2.1, the eslint pair exact 7.2.1
    (`@aval-adr/eslint-config` stays direct, ADR-0076, at the range greenrack-eslint-config 7.2.1's peer asks; `pnpm install` prints no unmet-peer warning for it); `greengate.conf` row
    `greenrack-doctor` running `npx -y @greenharness/greenrack-cli@^7 doctor`,
    then `greengate trust`; `ui-handoff.yml` `/duro-mockup` →
    `/greenrack-mockup`; `.prettierignore`'s skill paths and comment;
    CLAUDE.md's design-system section (the `greenrack` CLI/MCP, `greenrack/*`
    rules, 7.x); Duro-DS comments in `vite.config.ts`, `postcss.config.js`,
    `react-router.config.ts`, `app/styles/global.css`, `app/test/setup.ts`,
    `ci.yml`, `release.yml`; drop `.claude/.duro-session.cache*` from
    `.gitignore` (greenrack 7.1.1's hook template removes it; activity-vision
    needed a follow-up PR for this).
  - (c) Install by the recipe; `rm -rf node_modules/.vite`. The rewritten
    regex and postcss path match files on disk; every renamed import
    specifier resolves in the installed `exports`; `pnpm run build` and the
    SSR smoke pass with no `defineVars` error.
  - (d) `npx -y @greenharness/greenrack-cli@^7 hook install`, then `skill
install`. `git ls-files .claude/hooks` lists only `aval-heads.sh`,
    `greenrack-catalog.sh`, `greenrack-plan.sh`; `git ls-files .claude/skills` holds `greenrack-mockup` and no `duro-mockup`; the PR records the entries
    per event; `hook install --check` and `skill install --check` exit 0;
    `verify-duro-app`'s `generated-from` hashes are refreshed for the files
    this commit moved.
  - (e) The Baseline's served-CSS, hash and email checks again.
  - (f) `greengate agents-md`; `sweep-app.sh --check --allow <f> <wt>` exits
    0; `pnpm dev` serves `/` once without `504 Outdated Optimize Dep`.
  - (g) Dockerfile builder steps in a detached worktree at the commit.
  - Commit `feat!: move onto greenrack 7`. The PR body carries
    `Mockup: none — design-system rename and version move, no screen
designed`. Merge with a merge commit so commits 1–3 stay bisectable.
- [ ] Phase 4: release v1.65.0 after the merge.
  - `git log --oneline v1.64.0..origin/main` lists only the chart bump and
    the sweep; no migration in `app/lib/db/migrations` changed.
  - `pnpm audit --prod` and `scripts/mcp`'s `npm audit --omit=dev` before
    the tag. Tag with `tag-release`; read the release run's `conclusion`, the
    `update-helm-chart.yaml` run's `conclusion`, and the `fredericrous/charts` PR merged (its auto-merge is `continue-on-error`); the chart 1.65.0 is served by the zot mirror before
    the pin.
  - Before the homelab merge, count ERROR lines in `duro` and `duro-worker` logs over 30 min on 1.64.0 into the scratch dir (the baseline the Done check compares to).
  - Homelab PR (`homelab-wt-duro-1.65.0`): `kubernetes/homelab/apps/duro/helm-release.yaml`
    1.64.0 → 1.65.0, merged with `merge-when-green`; after homelab main's new
    OCI digest, reconcile OCI source → kustomization `duro` → HelmRelease
    `duro/duro`, gated on the spec reading 1.65.0.
  - Done when the HelmRelease is Ready at 1.65.0 and `status.history[0]` reads chart 1.65.0, status deployed (no remediation rollback); both Deployments' container image is `ghcr.io/fredericrous/duro-app:1.65.0`; `duro` and `duro-worker`
    Ready, 0 restarts after 30 min, ERROR lines no more than 1.64.0's last 30
    min; `/health` 200 on `home.` and `join.`; an invite page renders; served
    JS/CSS hold no `@duro-app` and no `--duro-`, and 0 unresolved static
    tokens.
  - Rollback: revert the homelab PR and reconcile the same chain back to
    1.64.0 (no migration).
- [ ] Phase 5: the programme record, in a decisions worktree, one PR:
      `docs/programmes/greenrack-rename/t08-fleet-sweep.md`'s duro-app entry
      becomes "merged, released and live"; `docs/programmes/greenrack-rename/map.md`'s
      Handoff names homelab next. t08 stays open.

### 🧑 Your steps

- After Phase 4, `greenbelay open 'https://home.daddyshome.fr/'` then
  `greenbelay open 'https://home.daddyshome.fr/admin/applications'`: compare
  with `<scratch>/baseline/1280-dark-home.png` and
  `<scratch>/baseline/1280-dark-admin.applications.png` (the scratch path is
  written into the PR body at Phase 0) and check the
  console shows no errors (Authelia; the agent has no session).

## Verification

| Check                                                         | Expected                                                                                                                                                                                  | Observed |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| typecheck, lint, format:check, tests at baseline and c1–c3    | exit 0; lint warnings ≤ baseline; same test count                                                                                                                                         |          |
| lock and audit at each commit                                 | DS-only moves; grep exits 1; audit IDs ⊆ baseline (chp3), main tree and `scripts/mcp`                                                                                                     |          |
| `pnpm why` DS + eslint packages at c3                         | one copy each, no `@duro-app`                                                                                                                                                             |          |
| served CSS and hash probe                                     | 0 unresolved static tokens; no `@media (min-width: var(`; 0 missing hashes at 7.2.1                                                                                                       |          |
| token value diff 5.9 → 7.2.1                                  | changes named before c1                                                                                                                                                                   |          |
| print-config on the nine files                                | same bans per file under the renamed ids                                                                                                                                                  |          |
| browser-check crawl, dark + light, 1280 + touch 390, surfaces | coverage reported; only the expected differences                                                                                                                                          |          |
| email HTML diff per commit                                    | empty except named renames                                                                                                                                                                |          |
| hooks and skills                                              | one greenrack entry per event + aval-heads; both `--check` exit 0                                                                                                                         |          |
| `sweep-app.sh --check` at c3                                  | exit 0                                                                                                                                                                                    |          |
| Dockerfile builder steps at c3                                | exit 0                                                                                                                                                                                    |          |
| Phase 4 cluster                                               | HelmRelease Ready 1.65.0; pods 0 restarts at 30 min; ERROR lines ≤ the pre-merge 1.64.0 count; `/health` 200 both hosts; an invite page renders; served assets 0 `@duro-app`, 0 `--duro-` |          |

## Decision log

- 2026-11-21 — Target 7.2.1, not the Handoff's 7.1.2: f99 names no blocker
  for 7.2.x, and a sweep targets the current release.
- 2026-11-21 — No main-first phase: v1.64.0 equals main apart from the
  `[skip ci]` chart bump.
- 2026-11-21 — The eslint pair moves at commit 2 only (already 6.0, split
  done); commit 1 moves the runtime packages.
- 2026-11-21 — Phase 0 seed: invite tokens are stored hashed and the dev
  email layer never logs them, so admin actions cannot seed the public pages.
  A file-backed dev PGlite in the scratch dir holds `seedDevFixtures` plus one
  invite, cert reveal and recovery request made through the repos' own
  `create`; every run serves a fresh copy, so ids and tokens match across
  commits. `RECOVERY_ENABLED=true` (else `/recover` is a 404).
- 2026-11-21 — States taken where the app has them: EmptyState from the
  collections empty as seeded (invitations, audit, a principal); the invalid
  state from `/settings/api-keys`' required name input (typed, cleared), as
  the only Field.Error forms sit behind the client-certificate check.
- 2026-11-21 — The baseline crawl ran directly; c1–c3 through browser-check.
  At c1 the DS Button lost `data-element-src`, so the crawl's selectors also
  match `data-style-src`; the baseline was re-crawled from a detached
  worktree with the same script (noise floor 163/163 AE 0).
- 2026-11-21 — c1 difference accepted by the person: a List draws no divider
  under its last row (DS #148, 5.34.3), seen in the admin cert panel/Drawer.
- 2026-11-21 — c3 difference accepted by the person: at 390 touch, Button and
  LinkButton no longer shrink below their label (DS #204, 7.1.2); the app
  detail action row then runs 15 px into the page padding (follow-up).
- 2026-11-21 — greenrack 7.3.0 and 7.4.0 shipped this morning (Field native
  validation message, Combobox fixes). Ranges stay ^7.2.1 as planned; the lock
  holds 7.2.1, the version the hash probe and token checks covered. Moving to
  7.4 is a follow-up.
- 2026-11-21 — The commit gate lints touched files with no warnings, so c3
  fixes two pre-existing warnings in renamed files (HelpPopover zIndex 50 is
  `layers.floating`; an unused import in home.tsx). The verify skill's
  `generated-from` hashes are refreshed for vite.config.ts and catalog.tsx
  only; six other rows were already stale on main (follow-up).

<!-- panel: repos=duro-app,homelab,decisions adds= reviewers=backend,lang:typescript,platform,react,tui,ui-design,unix,codex body-sha=b7f3975f2eca -->
