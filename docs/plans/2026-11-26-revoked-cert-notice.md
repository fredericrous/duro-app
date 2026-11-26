---
status: active
next: Phase 2 — release duro-app, bump kubernetes/homelab/apps/duro/helm-release.yaml, then the post-deploy checks and the person's iPhone visit
branch: feat/revoked-cert-notice
repos: [duro-app, homelab]
adrs: []
plan-id: p-01M8BNM5SQ906EDQJ0BS675GS7
---

# Send a revoked device cert to the devices page

## Review panel

📄 Full reviews: [2026-11-26-revoked-cert-notice.reviews.md](2026-11-26-revoked-cert-notice.reviews.md)
👉 **Decide:** none — approve if a revoked cert landing on Devices with an in-place "Add a device" is the flow you want to test.
📍 duro-app, homelab · 2 phases · 1 release · 1 step for you · next: Phase 1. Panel: backend, lang:typescript, platform, react, tui, ui-design, unix, game-ux, ux-research (opus-5-5), codex.
**Changed by review:** check is cheapest-first, CA last, 300 ms cap that cannot starve the CA cache; in-Alert button with a double-tap guard and a pending-claim variant; post-deploy proof the agent can actually run.
**Verdicts:** 9 approve; backend approve-with-changes on the Codex fix (2 mediums carried); 13 carried; words 1036 → 1483 (×1.43, mostly high and wrong-statement fixes); remove 0, merge 0.

## Picture

```
 iPhone (revoked cert 6F:5C...) --TLS--> Envoy duro-https
                                         [CA only, no CRL, XFCC=Cert]
                                                   |
                                                   v
 GET / --> signed in, and the XFCC cert is: pki-client issued,
           known to duro, owned by this user, revoked?
             yes --> every page but /devices: 302 /devices; writes 403
             no  --> home as today
 /devices --> warning: "the certificate this device presented was
              revoked on <date>; add a device to get a new one"
```

A revoked cert still reaches `home.daddyshome.fr` (that listener has no CRL,
by design: it is the way back in). duro now notices it and points the user to
the place that issues a new one.

## Context

The person wants to test, with the iPhone's current (revoked) client cert, a
flow that sends a revoked device to reissue, instead of reissuing by hand
first. No such flow exists: duro reads the presented cert (XFCC) only for
pending invites (`resolvePendingCertInvite`, `app/lib/workflows/invite.server.ts:500`),
and nothing tells a signed-in user that the cert their device presents is
revoked. Option chosen by the person (2026-11-26): a redirect and notice on
home, not a gateway-level redirect.

Facts checked:

- `mtls-duro-https` CTP: `xForwardedClientCert {mode: SanitizeSet, certDetailsToAdd: [Cert]}`, no `crl` (live). The plan `2026-11-25-gateway-enforces-client-cert-revocation.md` keeps duro-https and https-authelia without a CRL in Phases 4–5, so this keeps working after enforcement.
- The iPhone cert row: `user_certificates` username `daddy`, revoked 2026-09-23, `revoke_state completed`, expires 2026-12-10.
- `listUnrevoked` (devices loader) hides revoked certs, so the notice needs its own lookup.
- Issuing a new cert stays exactly as today: the "Add a device" button (`devices.newCert`), an OIDC session (Authelia 2FA) and the device budget. This change adds no action and no write.

## Phases

### Phase 1 — duro-app: presented-cert check, redirect, notice (PR 1, release)

<!-- panel: repos=duro-app -->

Files: `app/lib/workflows/presented-cert.server.ts` (new) and its test, `app/lib/auth.server.ts` and `app/lib/auth.server.requireAuth.test.ts`, `app/lib/mutations/settings.ts` and its test, `app/lib/services/ClientCaTrust.server.ts` and its test, `app/routes/devices.tsx`, `app/routes/devices.test.tsx`, `app/routes/home.tsx` and `app/routes/home.test.tsx` (unchanged from `origin/main`), `app/components/Header/Header.tsx` and its test, `app/components/DevicesSection/DevicesSection.tsx`, `app/locales/en/translation.json`, `app/locales/fr/translation.json`.

- `presented-cert.server.ts`: `presentedCertStatus(xfcc, username, { timeout })` → `Revoked{cert} | NotRevoked | Unproven | Unavailable`. It reuses `parseXfccCert` and `canonicalSerial` (`app/lib/client-cert.server.ts`), `ClientCaTrust.isIssuedByClientCa` and `CertificateRepo.findBySerialCanonical`. Checked cheapest first: the header parses (sync), duro has the row (one indexed query), `cert.username === username` (never reveals another user's cert), `revokedAt !== null`, and last, only for that hit, the pki-client CA signed it (a serial is unique per issuer; the listener also trusts the break-glass root). `Revoked` only when all hold; `Unproven` when a revoked row of the user's was found but the CA check ran out of time (treated as revoked, the safe side); `Unavailable` when the lookup failed (any cause, defects included) or ran out of time (nothing known). Never fails. The whole check runs under `Duration.millis(300)` on page loads (`5 s` in the `/devices` action). The CA call runs in a daemon fiber (`Effect.forkDaemon`, then `Fiber.join`), so a timed-out request does not cancel the CA refresh: it fills the cache for the next check (`Effect.disconnect` still interrupts it, only without waiting; see the results). `ClientCaTrustLive`'s Vault fetch (`app/lib/services/ClientCaTrust.server.ts`) gets its own 5 s timeout, keeping fail-closed with no cached CA and the last-good fallback. A hit logs `logInfo` with the canonical serial. `presentedRevokedCert` (Option) and `presentedRevokedNotice` (`{ revokedAt, label } | null`, for loader data) are views of it.
- `requireAuth` and `getAuth` (`app/lib/auth.server.ts`), changed at the preview (Decision log): a device whose status is restricted (`Revoked` or `Unproven`) may reach only `/devices` (and `/auth/*`). `requireAuth` redirects every other GET to `/devices` and refuses every write with 403. `getAuth` is confined too, because an action or a `?_routes=` data request reaches a route without its layout and most admin, requests, grants and invitations routes call only `getAuth`: it throws 403 on a write and reports no one signed in on a read (its existing no-session answer, so no caller sees a new redirect). The lookup runs once per `Request` object (a `WeakMap`), `/devices` skips it, and `Unavailable` fails soft (a slow query must not lock everyone out). This replaces the earlier home-only once-a-day redirect and its `duro_revoked_notice` cookie, which are gone; `home.tsx` is unchanged from `origin/main`. The Header shows only Devices and Log out while restricted (`restricted` prop from the Devices page).
- Email-only links while restricted (Decision log, second entry): the `/devices` action runs `emailOnlyWhileRevoked` (`app/lib/mutations/settings.ts`) whenever the status is not `NotRevoked` (`Revoked`, `Unproven` and `Unavailable`: a security rule fails closed), so `issueCert` and `showClaimLink` deliver the new-device link by email only and never in the response. `showClaimLink` gains an email delivery that checks the address first, refuses a second mail within a minute (earlier links stay live), re-issues the pending link and mails it. The page asks for email itself; its dialog gains a sending state (no QR slot, no copy button, one polite `role="status"` region) and an "emailed" state; the pending-claim button reads "Email the link again" while restricted and is disabled while a request is in flight.
- `devices.tsx` loader: add `presentedRevoked` from `presentedRevokedNotice(xfcc, auth.user)`, in its existing `runEffect`.
- `DevicesSection.tsx`: new optional prop `presentedRevoked`. When set, an `Alert variant="warning"` above the pending-claim Alert with `devices.presentedRevoked.body` (or `bodyLabelled` with the device name; en: "The certificate this device presented was revoked on {{date}}. Add a device to get a new one. If your browser still offers the old certificate, remove it, then choose the new one when your browser asks.") and, inside it as the pending-claim Alert does, `Inline gap="sm"` with a default-size `Button variant="secondary"` (`devices.presentedRevoked.action`) calling the same `openClaimDialog`, `disabled={isSubmitting}`; no new action or write. With a pending claim the warning has no button and its `bodyPending` names the pending Alert's "Email the link again" button: one remedy, never a second claim that spends the budget. The date uses the section's `formatDateTime`; fr strings in the same keys.

Mockup: none (one Alert in the existing pattern, beside the pending-claim
Alert in the same section); the PR body carries that line for the UI-handoff
workflow. Then release duro-app (tag-release); its chart version is Phase 2's
input.

### Phase 2 — homelab: deploy (PR 2)

<!-- panel: repos=homelab -->

Files: `kubernetes/homelab/apps/duro/helm-release.yaml` (the chart version, as in homelab #1318, `chore(duro): deploy duro-app 1.67.0`).

Bump to the Phase 1 release, merge on green; Flux rolls the web pods.

### 🧑 Your steps

- On the iPhone, with its current (revoked) cert, open `https://home.daddyshome.fr` and sign in if asked: you should land on Devices with the warning, and every other page (home, Settings, Admin) sends you back there; the header menu offers only Log out. Add a device there when you want the new cert. Once the iPhone presents its new cert, home opens normally and Devices shows no warning.

## Verification

- `presented-cert.server.test.ts` on PGlite (`~/test/test-runtime`), XFCC built from `app/test/fixtures/client-cert-fixture.pem` as `setup.test.tsx` does: Some for the owner's revoked cert; None for no header, an unparsable header, an unrevoked cert, another user's revoked cert, an unknown serial, a cert the CA did not sign (`Layer.succeed(ClientCaTrust, …false)`), and a repo error.
- `auth.server.requireAuth.test.ts`: signed in + the user's revoked XFCC → `/`, `/settings`, `/admin`, `/catalog.data` each 302 `/devices`; a POST to `/settings` 403; `/devices`, `/devices.data` and a POST to `/devices` pass; another user's revoked cert passes. Red with the restriction removed. `Header.test.tsx`: `restricted` drops "My requests".
- `presented-cert.server.test.ts` also covers `presentedRevokedNotice` (Some → `{ revokedAt, label }`, None → null), since `devices.test.tsx` stubs `runEffect`.
- `pnpm run test`, `pnpm run typecheck` and `pnpm run lint` exit 0 with 0 errors (lint gates the greenrack and role-selector rules).
- `devices.test.tsx`: the loader calls a mocked `presentedRevokedNotice` with the request's XFCC and the `requireAuth` user; the page shows the warning, found by the Alert's accessible role and its text with the date, with its "Add a device" button by role and name, disabled while the fetcher is submitting; with a pending claim, the `bodyPending` text and no button; and none when null while a pending-claim Alert is shown (no test ids).
- Local pilot (F2, UI): dev server (dev auth user `dev`, `ClientCaTrustDev`) with the fixture cert seeded as `dev`'s and revoked, behind a one-file local proxy that adds the XFCC header (scratch dir, not committed). A script asserts with `curl -q` (`~/.curlrc` follows redirects): `/`, `/settings` and `/admin` each 302 `/devices`, a POST to `/settings` 403, `/devices` 200 with the warning, exiting non-zero on a mismatch (curl exits 0 on any status), and prints home's `time_starttransfer` with and without the header. `browser-check` on `/devices` through the proxy: the warning with the date, at desktop and 390 px, light and dark, no console error; also beside a pending claim, with no unrevoked device, at the device limit, and with a 60-character label at 390 px.
- After deploy (Phase 2): HelmRelease `duro` Ready at the new chart and the pods on its image (a failed upgrade is remediated back, `helm-release.yaml:20-26`); `mtls-duro-https` still has `xForwardedClientCert`; after the person's iPhone visit, one `logInfo` hit with serial 6F:5C… and the 302 in the web pods' logs; `duro-home` tier2 P99 (target 1.5 s) over the 24 h before and after, a rise over 100 ms is fixed before closing.

### Phase 1 results (observed before push)

| check                                            | input                                                                                                                                                                      | expected                                                                                                                                                                                                                 | actual                                                                                                                                                                           |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit suite                                       | `pnpm run test` on 6ad84e2                                                                                                                                                 | all green                                                                                                                                                                                                                | 174 files, 1638 tests passed                                                                                                                                                     |
| typecheck, lint                                  | `pnpm run typecheck`, `pnpm run lint`                                                                                                                                      | 0 errors                                                                                                                                                                                                                 | 0 errors (the 6 existing warnings)                                                                                                                                               |
| presented-cert check                             | `presented-cert.server.test.ts` (PGlite + stubbed services)                                                                                                                | Some for the owner's revoked cert; None for no/unparsable header, unrevoked, another user's, unknown serial, untrusted CA, repo error, CA check that never returns (TestClock)                                           | 12 pass                                                                                                                                                                          |
| CA cache under a slow Vault                      | `ClientCaTrust.server.test.ts`, real `ClientCaTrustLive` + msw                                                                                                             | a 500 ms Vault answer behind a 300 ms wait still fills the cache: second call answers, 1 fetch; a hung fetch at 5 s: false with no cache, cached answer with one                                                         | pass; `Effect.disconnect` FAILED this test (2 fetches): it still interrupts the refresh, only without waiting, so the check runs the CA call in `Effect.forkDaemon` and joins it |
| home redirect (superseded)                       | `home.test.tsx`                                                                                                                                                            | owner's revoked XFCC → 302 `/devices` with no Set-Cookie; matching cookie → home, `presentedRevokedCert` not called; other serial → 302; no header / another user's → home                                               | pass; red with the redirect removed (2 fail)                                                                                                                                     |
| devices loader and page (cookie part superseded) | `devices.test.tsx`                                                                                                                                                         | lookup called with the XFCC and user; cookie set only with a notice and no matching cookie; warning by role with its button `within` it, disabled while submitting; pending variant without button; no warning when null | pass; red with `disabled={isSubmitting}` removed (1 fail)                                                                                                                        |
| pilot: redirect and cookie (superseded)          | dev server + a scratch proxy adding XFCC of a cert with the seeded serial `aa:bb:cc:dd:00:00:00:01`, labelled (61 chars) then revoked through `/devices`; `curl -q` script | `/` 302 `/devices`, no cookie; `/devices` 200 + `duro_revoked_notice=aabbccdd00000001; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`; `/` with it 200                                                           | all pass (script exit 0). `~/.curlrc` follows redirects: `curl -q` is needed to see the 302 alone                                                                                |
| pilot: valid-cert cost                           | `/` TTFB median of 15, unknown-serial cert vs no header, 2 rounds, load 23–34                                                                                              | under 100 ms                                                                                                                                                                                                             | −105 ms, +55 ms (noise ±100 ms at that load; production P99 is the real check)                                                                                                   |
| pilot: page, 1280 and 390                        | `browser-check` ×3 (isolated contexts)                                                                                                                                     | warning with label and date, its own button, no overflow, no console error                                                                                                                                               | as expected; 390: warning 262 px, button visible, 8 lines, no overflow; dark contrast ≈12.8:1 (computed)                                                                         |
| pilot: in-Alert button                           | click at 390, MutationObserver on `disabled`                                                                                                                               | disabled during the request; claim dialog; one POST                                                                                                                                                                      | `disabled` set, "Scan with the new device" dialog with QR, one POST 200                                                                                                          |
| pilot: pending variant                           | reload after the claim                                                                                                                                                     | "Resume the device setup waiting below…", no button, waiting notice below                                                                                                                                                | as expected; both notices 336 px of 844 at 390                                                                                                                                   |
| pilot: device limit                              | 3 of 3 used                                                                                                                                                                | warning, next-available line, header button opens the limit dialog                                                                                                                                                       | as expected; "You've used today's device setups", no POST                                                                                                                        |
| pilot: light theme                               | dev app                                                                                                                                                                    | light screenshots                                                                                                                                                                                                        | not reachable: the dev app serves dark and has no colour-mode control; only dark was seen                                                                                        |

Implementation review round 1, fixed in the code:

| check                                    | input                                                                                                          | expected                                                                      | actual                                                        |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------- |
| daemon fiber through the production path | `presented-cert.server.test.ts`: `presentedRevokedCert` with a CA stub gated on a `Deferred`, TestClock 300 ms | the request is None, and after the gate opens the CA check runs to its end    | pass; red with a plain `yield* trust.isIssuedByClientCa(...)` |
| defects                                  | a repo that dies (`Effect.die(new RangeError)`)                                                                | None, logged; home cannot 500                                                 | pass with `catchAllCause`; red with `catchAll` (2 fail)       |
| no real waits                            | the slow-Vault cache test                                                                                      | gated msw handler + TestClock, no sleep                                       | 1 fetch over two calls, no real wait                          |
| copy and touch target                    | en/fr strings, in-Alert button                                                                                 | pending text names "Show the link again"; steps in order; default-size button | done                                                          |

Deliberate:

- `revokedAt` is normalised to an ISO string in `presented-cert.server.ts`, not in `CertificateRepo`'s row mapper (lang:typescript #1): the mapper feeds every caller, and changing what they all read is outside this plan; filed to the follow-ups inbox.
- Light theme was not seen (interface-review, implementation-review): the dev server renders the dev user's saved theme and offers no switch, and saving `light` did not change the server render. The warning is greenrack's `Alert variant="warning"`, whose light colours are the design system's own; the person's iPhone visit (Your steps) is the first light-theme view.

Deviation from the plan text: `Effect.forkDaemon` + `Fiber.join` instead of `Effect.disconnect` (the test above shows why). The first pilot pass got 400 on every POST: the scratch proxy rewrote Host, and React Router refuses a POST whose Origin and Host disagree; fixed in the proxy, not the app.

## Implementation review

- implementation-review (opus): approve-with-changes ×2; daemon fix tested through `presentedRevokedCert`, plan text corrected; deliberate: defects logged at warning, not error (the cause is logged whole with `Cause.pretty`; inbox). ~202k tokens, 163 s.
- backend (opus): approve-with-changes → approve; daemon test, `catchAllCause` + die test, holds-until note. ~165k, 114 s.
- lang:typescript (opus): approve-with-changes → approve; Duration, die test, role queries, `data()` class; deliberate: `revokedAt` normalised here, not in the shared repo mapper (inbox). The `getAuth` move cannot newly fail home: the dashboard layout's `requireAuth` reads the same session first. ~139k, 88 s.
- react (opus): approve, round 1; its two lows (role queries, precomputed message) fixed. 60k, 40 s.
- ui-design (interface-review, opus): approve-with-changes → approve; pending copy names "Show the link again", default-size button, steps in order; deliberate: light theme unseen (see above); pre-existing: the pending Alert's small "Show the link again" button (inbox). ~170k, 177 s.

After the preview change (Restrict to Devices):

| check              | input                                              | expected                                                                                                                                        | actual                                                                                    |
| ------------------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| suite              | `pnpm run test`, `typecheck`, `lint`               | green                                                                                                                                           | 174 files, 1635 tests (the cookie and home-redirect tests went with their code); 0 errors |
| restriction        | `auth.server.requireAuth.test.ts`                  | `/`, `/settings`, `/admin`, `/catalog.data` 302 `/devices`; POST `/settings` 403; `/devices` (+ `.data`, POST) pass; another user's cert passes | pass; red with the call removed (2 fail)                                                  |
| pilot: restriction | `assert-restrict.sh` through the proxy (`curl -q`) | `/`, `/settings`, `/admin`, `/catalog`, `/requests` 302 `/devices`; POST 403; `/devices` 200 with the warning and no "My requests"              | all pass; `origin/main` in the same state serves `/` and `/settings` 200                  |
| pilot: header      | `browser-check`, 390 and 1280                      | header: Duro, Devices, the account menu with Logout only; typed URLs and the logo land on `/devices`                                            | as expected; no console errors                                                            |

After the email-only change:

| check    | input                                                                       | expected                                                                                                                              | actual                                 |
| -------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| mutation | `settings.test.ts`                                                          | `emailOnlyWhileRevoked` turns link into email for `issueCert` and `showClaimLink`, leaves others; both answer `certSent` with no link | pass                                   |
| action   | `devices.test.tsx`                                                          | revoked: the handler gets `delivery: "email"` though the form asked `link`; not revoked: `link` kept                                  | pass; red with the enforcement removed |
| page     | `devices.test.tsx`                                                          | the warning's button posts `delivery=email`; the dialog says "We emailed you the link"; no "Copy link"                                | pass                                   |
| pilot    | POST `issueCert` and `showClaimLink` with `delivery=link` through the proxy | `certSent`, no token in the answer                                                                                                    | both `certSent: true`, no token        |

After review round 1 on the confined, email-only version:

| check                    | input                                                                                                                                     | expected                                                                                                                                                                                                                                         | actual                                                                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| writes through `getAuth` | `requireAuth.test.ts`; POST `/requests.data` and `/admin/grants.data` (intent `revoke`) on the live dev server, confined vs `origin/main` | 403 from a confined device                                                                                                                                                                                                                       | 403, 403; `origin/main` answers the same grants write 200. Red with the `getAuth` confinement removed (2 fail)                   |
| reads through `getAuth`  | `?_routes=routes/catalog` GET, confined                                                                                                   | a signed-out view, never a redirect                                                                                                                                                                                                              | the catalog data an anonymous caller already gets (pre-existing: `?_routes=` skips the dashboard gate for everyone; not widened) |
| one lookup per request   | `requireAuth`, `getAuth`, `requireAuth` on one `Request`                                                                                  | `presentedCertStatus` called once                                                                                                                                                                                                                | pass                                                                                                                             |
| fail closed              | `devices.test.tsx` (action), `presented-cert.server.test.ts`                                                                              | `Revoked`, `Unproven` and `Unavailable` get email; `NotRevoked` keeps the asked delivery; `Unavailable` on a lookup error or timeout, `Unproven` on a CA check that never answers                                                                | pass; red with only `Revoked` emailing (2 fail)                                                                                  |
| mail pile                | `settings.test.ts`                                                                                                                        | a second email within a minute refused, nothing minted; no address: the waiting link is not replaced                                                                                                                                             | pass                                                                                                                             |
| dialog                   | `devices.test.tsx`                                                                                                                        | restricted: "Sending the link…" title and one status region with no QR, no copy button, no "Scan with the new device"; then the emailed text in the same region; "Email the link again" disabled in flight, posting `showClaimLink` with `email` | pass                                                                                                                             |

Deliberate:

- `Unavailable` (a lookup error or timeout at the first step) confines nobody: a slow query must not lock every user into `/devices`; it does force email-only links. A revoked row whose CA check did not answer (`Unproven`) is confined.
- The `?_routes=` read of a `getAuth`-only loader returns what an anonymous caller already gets; closing that is the admin-guard audit's pre-existing work, not this plan's.

## Decision log

- 2026-11-26, at the preview, the person asked "maybe the top right menu in the header shouldn't be shown when cert is revoked !?" and then chose **Restrict to Devices** over "hide the menu only" and "keep it as is": while a device presents its user's revoked certificate, duro serves it `/devices` only, enforced in `requireAuth`. The once-a-day home redirect and its cookie were dropped with it; the reviews above judged the earlier version, and the branch gets a fresh round 1.
- 2026-11-26, the person asked "when a device has expired, should we limit the way to get the link to email only?" An expired certificate never reaches duro today (Envoy checks dates on every listener; follow-up t20 will inherit this rule), but the live case, a revoked device that may be the lost one with a live session, could re-enroll itself from the QR or "Copy link". The person chose **Email only** over "email + fresh sign-in" and "keep QR and copy".

## Rollback

- Revert PR 1 and release; or set the chart back in homelab. Nothing is written, so nothing to undo in data.

## Non-goals

- Renewing or reviving the revoked cert itself (a revoked key never gets a renewal: follow-up t20's rule).
- Any change on CRL-enforcing listeners (they refuse in TLS; no HTTP exists to redirect).
- Marking "this device" in the devices list for valid certs.

## Code review

- duro-app: backend, lang:typescript, react, ui-design (platform left out: no manifest or infra file; architect left out: one helper module beside an existing workflow, no new contract)
- homelab: platform (backend, lang:go, lang:python, lang:typescript, unix, tui, architect left out: one chart version line in a HelmRelease)

<!-- panel: repos=duro-app,homelab adds=screen reviewers=backend,lang:typescript,platform,react,tui,ui-design,unix,game-ux,ux-research,codex body-sha=926198247b30 -->
