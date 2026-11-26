---
status: active
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
             yes --> 302 /devices (+ cookie: once a day per serial)
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

Files: `app/lib/workflows/presented-cert.server.ts` (new) and its test, `app/lib/services/ClientCaTrust.server.ts` and its test, `app/routes/home.tsx`, `app/routes/home.test.tsx`, `app/routes/devices.tsx`, `app/routes/devices.test.tsx`, `app/components/DevicesSection/DevicesSection.tsx`, `app/locales/en/translation.json`, `app/locales/fr/translation.json`.

- `presented-cert.server.ts`: `presentedRevokedCert(xfcc, username)` → `Option<{ revokedAt, label, serial }>`. It reuses `parseXfccCert` and `canonicalSerial` (`app/lib/client-cert.server.ts`), `ClientCaTrust.isIssuedByClientCa` (`app/lib/services/ClientCaTrust.server.ts`) and `CertificateRepo.findBySerialCanonical`. Some only when all hold, checked cheapest first: the header parses (sync), duro has the row (one indexed query), `cert.username === username` (never reveals another user's cert), `revokedAt !== null`, and last, only for that hit, the pki-client CA signed the cert (a serial is unique per issuer; the listener also trusts the break-glass root). Never fails: a repo error is `None` plus `Effect.logWarning`; the whole check runs under `Effect.timeout("300 millis")`, a timeout is `None` plus `logWarning`. The CA call is wrapped in `Effect.disconnect`, so a timed-out request does not cancel the CA refresh: it finishes in the background and fills the cache for the next check. `ClientCaTrustLive`'s Vault fetch (`app/lib/services/ClientCaTrust.server.ts:45`, untimed today) gets its own 5 s timeout, keeping fail-closed with no cached CA and the last-good fallback. Test: a CA check taking 500 ms makes the first notice check `None` within its budget and a later one `Some`. A hit logs `logInfo` with the canonical serial. `presentedRevokedNotice(xfcc, username)` maps it to `{ revokedAt, label } | null` for loader data (no Option there).
- `home.tsx` loader: after `getAuth`, when `auth.user` is set and the XFCC header is present, run the check before streaming. It parses the XFCC first and skips the check when cookie `duro_revoked_notice` (raw `Cookie` header parse, not `createCookie`) already equals its canonical serial; `getAuth` runs once and its result goes into `loadHomeData`. On a hit, throw `redirect("/devices")` with `Set-Cookie: duro_revoked_notice=<serial>; Path=/; Max-Age=86400; HttpOnly; Secure; SameSite=Lax`. So the redirect happens once a day per revoked serial, and home stays reachable with the old cert. No header, or no session: unchanged (the dashboard layout's `requireAuth` still sends a signed-out visitor to OIDC first).
- `devices.tsx` loader: add `presentedRevoked` from `presentedRevokedNotice(xfcc, auth.user)`, in its existing `runEffect`.
- `DevicesSection.tsx`: new optional prop `presentedRevoked`. When set, an `Alert variant="warning"` above the pending-claim Alert: `devices.presentedRevoked.body` ("The certificate this device presented was revoked on {{date}}. Add a device to get a new one, then choose it when your browser asks. You may need to remove the old certificate first.") and, with a label, `devices.presentedRevoked.bodyLabelled` naming it. The date uses the section's existing `formatDateTime`. Inside, as the pending-claim Alert does (`DevicesSection.tsx:577-586`): `Stack gap="sm"` > `Text as="p"`, then `Inline gap="sm"` with `Button variant="secondary" size="small"` (`devices.presentedRevoked.action`, "Add a device") calling the same `openClaimDialog`, with `disabled={isSubmitting}` as the header button has (`DevicesSection.tsx:557`), so a second click cannot issue a second cert; no new handler, action or write. When a pending claim exists, the warning has no button and reads `devices.presentedRevoked.bodyPending` ("…was revoked on {{date}}. Resume the device setup waiting below to get a new one."): one remedy, never a second claim that spends the budget (`DevicesSection.tsx:545`). fr strings in the same keys.

Mockup: none (one Alert in the existing pattern, beside the pending-claim
Alert in the same section); the PR body carries that line for the UI-handoff
workflow. Then release duro-app (tag-release); its chart version is Phase 2's
input.

### Phase 2 — homelab: deploy (PR 2)

<!-- panel: repos=homelab -->

Files: `kubernetes/homelab/apps/duro/helm-release.yaml` (the chart version, as in homelab #1318, `chore(duro): deploy duro-app 1.67.0`).

Bump to the Phase 1 release, merge on green; Flux rolls the web pods.

### 🧑 Your steps

- On the iPhone, with its current (revoked) cert, open `https://home.daddyshome.fr` and sign in if asked: you should land on Devices with the warning. Add a device there when you want the new cert. Opening home again within a day stays on home: the redirect runs once a day per cert. Once the iPhone presents its new cert, home opens with no redirect and Devices shows no warning.

## Verification

- `presented-cert.server.test.ts` on PGlite (`~/test/test-runtime`), XFCC built from `app/test/fixtures/client-cert-fixture.pem` as `setup.test.tsx` does: Some for the owner's revoked cert; None for no header, an unparsable header, an unrevoked cert, another user's revoked cert, an unknown serial, a cert the CA did not sign (`Layer.succeed(ClientCaTrust, …false)`), and a repo error.
- `home.test.tsx`: signed in + revoked XFCC → 302 `/devices` with the cookie; same request with `duro_revoked_notice=<serial>` → home data, and no repo call; a cookie holding another serial → 302; signed in, no header → home data; another user's cert → home data. The 302 case fails on `origin/main`.
- `presented-cert.server.test.ts` also covers `presentedRevokedNotice` (Some → `{ revokedAt, label }`, None → null), since `devices.test.tsx` stubs `runEffect`.
- `pnpm run test`, `pnpm run typecheck` and `pnpm run lint` exit 0 with 0 errors (lint gates the greenrack and role-selector rules).
- `devices.test.tsx`: the loader calls a mocked `presentedRevokedNotice` with the request's XFCC and the `requireAuth` user; the page shows the warning, found by the Alert's accessible role and its text with the date, with its "Add a device" button by role and name, disabled while the fetcher is submitting; with a pending claim, the `bodyPending` text and no button; and none when null while a pending-claim Alert is shown (no test ids).
- Local pilot (F2, UI): dev server (dev auth user `dev`, `ClientCaTrustDev`) with the fixture cert seeded as `dev`'s and revoked, behind a one-file local proxy that adds the XFCC header (scratch dir, not committed). A script asserts `curl -sS -o /dev/null -D - -w '%{http_code} %{redirect_url}'` on `/` gives `302 …/devices` with `Set-Cookie: duro_revoked_notice=`, then with `-b 'duro_revoked_notice=<serial>'` gives `200`, exiting non-zero on a mismatch (curl exits 0 on any status), and prints home's `time_starttransfer` with and without the header. `browser-check` on `/devices` through the proxy: the warning with the date, at desktop and 390 px, light and dark, no console error; also beside a pending claim, with no unrevoked device, at the device limit, and with a 60-character label at 390 px.
- After deploy (Phase 2): HelmRelease `duro` Ready at the new chart and the pods on its image (a failed upgrade is remediated back, `helm-release.yaml:20-26`); `mtls-duro-https` still has `xForwardedClientCert`; after the person's iPhone visit, one `logInfo` hit with serial 6F:5C… and the 302 in the web pods' logs; `duro-home` tier2 P99 (target 1.5 s) over the 24 h before and after, a rise over 100 ms is fixed before closing.

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
