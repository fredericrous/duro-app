---
name: verify-duro-app
description: Start a throwaway, isolated duro-app dev server on a free loopback port, signed in as the seeded dev user, prove it renders, drive its pages through browser-check, collect evidence and stop it. Use for worktree-task F2 in this repository whenever a change needs the running app, not only vitest.
---

# verify-duro-app

generated-from (first 12 hex of `git hash-object <file>`; a file whose
hash moved may have made a step below stale):

- package.json fbf2d1cf7229
- vite.config.ts cea04809f5f8
- react-router.config.ts f8525650e242
- app/routes.ts 8b54497526bd
- app/lib/auth.server.ts b58a57c38566
- app/lib/services/AppLayer.server.ts 14c25077dd15
- app/lib/config.server.ts 29c016d4fcb3
- app/lib/db/client.server.ts a408c5e9450d
- app/lib/db/seed-dev.server.ts 4af244e97643
- app/routes/health.ready.ts b777e34c790d
- app/routes/api.catalog.ts f05f7072b9ff
- app/routes/catalog.tsx 48f25f9ef368
- app/routes/admin.tsx eddda186c74f
- app/routes/settings.tsx 9c08cea75db5
- app/locales/en/translation.json 55459f9795fe
- .env.example aef606f08663

duro-app is a React Router (SSR) app on Effect. With
`NODE_ENV=development` the dev server swaps every outside service for a
dev layer (users, certificates, email, OIDC, provisioning), signs each
request in as the user `dev` (admin), and runs an in-memory PGlite that
it migrates and seeds at boot. A few layers still read real addresses
(LLDAP, Vault, the operator, Forgejo, OpenTelemetry): Launch points all
of them at a dead loopback port.

All steps use one script. Run each step as its own tool call, from the
worktree root (it needs the worktree's `node_modules`:
`pnpm install --frozen-lockfile`):

```bash
v=.claude/skills/verify-duro-app/scripts/verify.py
```

Shell variables do not survive between tool calls: set `v` again in each,
and paste the pidfile path Launch printed.

## Launch

```bash
v=.claude/skills/verify-duro-app/scripts/verify.py
python3 "$v" launch
```

Run it with the Bash tool's `timeout` at 600000 (or in the background):
a start under load takes longer than the default 120 s, and a tool
timeout SIGKILLs the launcher before it can tear down.

`python3` may be any 3.9 or later (macOS's `/usr/bin/python3` is 3.9);
the script is stdlib only. `verify.py --help` prints the usage.

- Prints one stdout line once ready, the pidfile path
  (`${TMPDIR:-/tmp}/verify-duro-app-<h>.json`, `<h>` from the worktree's
  real path). Keep it: Doctor, Drive, brief and Cleanup take it. The
  same path goes to stderr first, as `pidfile: <path>`, before anything
  starts.
- Starts `node_modules/.bin/react-router dev` with `--host 127.0.0.1`,
  `--port <p>` and `--strictPort`. Through the pnpm shim, never
  `node …/bin.js`: the shim's `NODE_PATH` is what resolves
  `@stylexjs/babel-plugin`, which `vite.config.ts` names; without
  it every page is a 500.
- Sets `ALLOWED_ORIGIN_SUFFIX=127.0.0.1`, the host it serves: admin
  mutations check the request's Origin against it, and the dev default
  `localhost` answered every one from the brief's URL with 403 "Invalid
  origin" (t12, 2026-11-20).
- Ready means all three: the listener on the port is in the group Launch
  started (a foreign server on the port never counts), `/health/ready`
  is 200 (the database answers), and `/` renders HTML (the first render
  compiles the routes).
- No fixed deadline: Launch waits while the server group keeps using
  CPU. Reaching ready costs about 75 CPU-s on a cold worktree (no
  `node_modules/.vite`) and about 50 warm, whatever the load, so the
  wall time follows the load: 30 s at load 9, 70-110 s at 30-100,
  170 s at 220 (measured 2026-11-20, t05). Until then vite's `Local:`
  line is in the log and no request is served yet: that is a compile
  in progress, not a hang. Launch fails as `stalled` when the group
  gains under 2 CPU-s in 30 s (an idle server gains 0-1.2), and at a
  410 s cap, which leaves one more wait pass, the settle below and the
  teardown under the tool's 600 s.
- Ready is not the end of the start. Launch then waits until the group
  is quiet (under 0.3 CPU-s in 3 s, at most 30 s) and reads the log. A
  line `optimized dependencies changed. reloading` means vite's dep scan
  missed an import, found it on the ready probe's render and re-bundled:
  a page loaded before that crashes with t01's "Invalid hook call".
  Launch fails with the line quoted, as a miss below. On a cold worktree
  that line came about 1 s after ready, 3 of 3 runs (t11, 2026-11-20); a
  warm one (`node_modules/.vite` kept) has the deps cached and never
  logs it, so only a cold Launch proves the scan.
- On a miss it prints the last 20 log lines to stderr and keeps a copy
  of the log at `${TMPDIR:-/tmp}/verify-duro-app-<h>.last.log` (the
  state directory is removed), then exits 1. The `fail:` line names the
  last readiness check that failed.
- Empty data: a fresh `mktemp -d` state directory holds the log, `HOME`
  and `TMPDIR`; the store is in memory and seeded at boot (12 apps,
  16 roles, 8 grants, 2 pending requests, users Alice and Bob). The dev user's
  catalog lists 11 of the 12 apps, which is the count Doctor prints.
- Isolation:
  - the server's environment is built from nothing; `PATH` holds only
    node's directory, `/usr/bin` and `/bin`;
  - every address the app reads (`LLDAP_URL`, `NAS_VAULT_ADDR`,
    `VAULT_ADDR`, `OPERATOR_API_URL`, `FORGEJO_*`, `AUTHELIA_URL`,
    `OIDC_ISSUER_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT`, …) is
    `http://127.0.0.1:9`; credentials are throwaway strings;
    `DATABASE_URL`, `DURO_DB_PATH`, `DISCORD_WEBHOOK_URL` and the tokens
    are never set;
  - Launch refuses (exit 2) when `.env`, `.env.local`,
    `.env.development` or `.env.development.local` exists in the
    worktree: react-router dev copies every key of them over the
    environment. The live checkout's `.env` sets `DURO_DB_PATH`, which
    would swap the seeded store for a file one. Run from a fresh
    worktree;
  - Launch scans `app/` for the environment variables the code reads,
    as `process.env.X`, `Config.<kind>("X")` or `requireConfig("X")`
    (not `import.meta.env` or a computed name), and refuses (exit 2,
    `fail: unclassified env …`) a name that `verify.py` does not
    classify. A pull request that adds one adds it to `verify.py`
    too.
- Sign in: none needed. `NODE_ENV=development` makes `requireAuth`
  return the user `dev` (`dev@localhost`, groups `family`, `media`,
  `lldap_admin`) for every request without a session. A preview
  guide's `Sign in:` line cites this: no login, the dev server is
  `dev`. Never a real account, never a session token.
- The server leads its own process group (`Popen(start_new_session=True)`,
  macOS has no `setsid(1)`); the group id goes to `<state>/pgid` right
  after the start, then the pidfile is written atomically.
- A Launch while the group in the pidfile is alive prints
  `fail: already running` and starts nothing. Two Launches started at
  the same instant are not guarded against.
- HUP, INT or TERM before ready tears the attempt down (group, state
  directory, pidfile) and exits 129, 130 or 143. They are held while the
  server starts and its group id is written, so no signal can orphan
  it. SIGKILL of the launcher (a tool-call timeout) cannot be caught:
  run Cleanup with the `pidfile:` path from stderr.
- A port lost between the probe and the bind is retried once.

## Doctor

```bash
v=.claude/skills/verify-duro-app/scripts/verify.py
python3 "$v" doctor <pidfile>
```

One line: `ok: ready on :<port>, dev sign-in, <n> seeded apps`, or a
`fail: … — <next step>` line on stderr. Exit 0 ready; 1 not ready (group
gone, the port no longer served by that group, `/health/ready` not 200,
`/admin` not 200 — production auth redirects it to OIDC — `/api/catalog`
unreadable, an empty catalog, which means no seed, or the vite re-bundle
line in the log once the group is quiet again, quoted as in Launch); 2 no pidfile or
an unreadable one. It
checks what the app wired, not only that it answers. A failing Doctor
is a blocker report, not a repair.

## Drive

The app is a user interface: hand the browser work to the
`browser-check` agent. For each feature the change touches, print its
brief and pass it verbatim as the agent's prompt:

```bash
v=.claude/skills/verify-duro-app/scripts/verify.py
ev="$HOME/.claude/greenbelay/attestations/$(git rev-parse --short HEAD)"
python3 "$v" brief <pidfile> "$ev" catalog
```

Features (`features/README.md`): `home`, `catalog`, `settings`,
`admin`. The brief carries the live URL, a fresh isolated context, the
viewports, the steps and questions from the feature's `## Driving it`,
the console and network checks, and where to save screenshots. Add the
questions your change raises at the end. Read only the agent's report.

The server-rendered fallback, always run, and the whole Drive when
`browser-check` is absent (no Green Harness):

```bash
v=.claude/skills/verify-duro-app/scripts/verify.py
ev="$HOME/.claude/greenbelay/attestations/$(git rev-parse --short HEAD)"
python3 "$v" drive <pidfile> "$ev" home catalog settings admin
```

Each journey GETs its pages as `dev` and requires a 200 with seeded
text on it. It prints `ok: <journey> passed — <file>` or
`fail: … — read <file>`; exit 1 when any fails. After the journeys it
waits for the group to go quiet and fails, with the line quoted, when
the log holds vite's re-bundle line: any request can find an import the
scan missed. Run it after the `browser-check` agents, so that its read
of the log covers their visits too. It proves routing,
loaders, sign-in and seed; clicks, client state and layout need a
browser. Without `browser-check`, drive those with Playwright or the
Chrome DevTools protocol by hand, using the same brief.

## Evidence

- `drive` writes `verify-duro-app-<journey>.json` (each GET, its status,
  the markers found and missing) and copies the server log; the
  `browser-check` brief saves `verify-duro-app-<feature>-<n>-<width>.png` (step
  number, viewport width).
  Both go to the directory worktree-task F3 names, outside the worktree.
  `drive` and `brief` refuse a directory inside it.
- Without Green Harness (no `~/.claude/greenbelay`), pass any directory
  outside the worktree, for example one from `mktemp -d`.
- What stays unproven locally: LLDAP, Vault, the operator, Forgejo,
  email and OIDC are dev doubles or a dead port. A change to one of
  those integrations needs its own check against the real service; that
  is a separate step the person approves, never a default here.
- A skipped journey or precondition is a failure, not a pass.

## Cleanup

```bash
v=.claude/skills/verify-duro-app/scripts/verify.py
python3 "$v" cleanup <pidfile>
```

1. No pidfile: `fail: no pidfile at <path> — nothing to stop`, exit 1.
2. If the leader is alive with another start time, the id was reused:
   nothing is signalled, the pidfile and state directory go,
   `ok: <pgid> reused, nothing signalled`. Else it signals the group only
   while `pgrep -g <pgid>` lists members.
3. `kill -TERM -<pgid>`, up to 5 s, then `kill -KILL -<pgid>`. Never by
   name: another session's `node` or vite may share it.
4. Survivors: `fail: <pgid> still has <pids>`, the state directory is
   kept, exit 1. A state directory that cannot be removed:
   `fail: could not remove <dir> (…)`, exit 1. No recorded start time
   with a live leader (a Launch killed before `ps` ran): a `fail:` line
   naming the `kill -TERM -<pgid>` to run by hand, exit 1.
   Otherwise `ok: stopped <pgid>, removed <dir>`, exit 0.

Every write a journey made (a request, an API key) was in memory and is
gone after Cleanup. Copy anything you need out of the state directory
first (`drive` already copied the log).
