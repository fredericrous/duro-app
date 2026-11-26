# Send a revoked device cert to the devices page — full reviews

## Full reviews (reference)

Carried into implementation (13): log which step timed out (backend); timeout test with Effect.never and TestClock, repo-call spy, `within(alert)` for both button lookups (lang:typescript); 100 ms limit in the pilot script (tui); redirects per serial over 7 days vs reissues (ux-research); old-cert sentence in `bodyPending` (ux-research); suppression cookie set on `/devices` after a successful lookup, home tests moved with it (codex medium); slow-CA test on the real `ClientCaTrustLive` with one fetch over two calls, and a 5 s TestClock test for the invite path (backend, after Codex); platform: count Vault-timeout warnings in the first 24 h.
Rejected (1): platform r1 #3, Rollback "nothing written": the cookie is inert after a revert (HttpOnly, 1 day, unread).

- backend (opus): r1 approve-with-changes (adds=screen blocking, 300 ms cap high, unobservable line, post-deploy proof), 37k/51 s; r2 approve-with-changes (unrunnable browser-check removed), 43k/35 s; deltas approve-with-changes (button guard), approve, then approve-with-changes on the Codex fix (2 mediums carried), 51k+55k+60k.
- lang:typescript (opus): r1 approve-with-changes (order, plain shape, raw cookie, other-serial case), 46k/61 s; r2 approve-with-changes (gate line, timeout test, spy), 52k/23 s; deltas approve-with-changes (guard, within), approve, 61k+65k.
- platform (opus): r1 approve-with-changes (HelmRelease/image/XFCC checks, P99, CA last), 35k/59 s; r2 approve, 41k/22 s; deltas approve ×2, 45k+49k.
- react (opus): r1 approve-with-changes (role selectors, loader-call assertion, post-deploy check), 34k/48 s; r2 approve-with-changes (gate line high), 39k/28 s; deltas approve-with-changes (guard high), approve, 48k+52k.
- ui-design (opus): r1 approve-with-changes (crowded-page cases, long label, second visit), 31k/31 s; r2 approve; deltas approve ×2.
- tui (opus): r1 approve (log-hit proof), 29k/23 s; r2 approve (100 ms bar carried); deltas approve ×2.
- unix (opus): r1 approve (scripted curl assertions), 25k/20 s; r2 approve; deltas approve ×2.
- game-ux (opus): r1 approve-with-changes (in-Alert button high, pending conflict, end-of-flow step), 31k/51 s; r2 approve; delta approve.
- ux-research (opus): r1 approve-with-changes (one remedy high, old-cert copy, cadence unbacked), 33k/58 s; r2 approve (bodyPending sentence carried); delta approve.
- codex (codex-cli 0.169.0, high effort): approve-with-changes: the timeout could starve the CA cache (high, applied as Effect.disconnect plus a 5 s fetch cap); cookie set on the redirect (medium, carried).
- design-system-lookup: Alert variant="warning", in-Alert Inline > Button secondary small, no new tokens, 30k/27 s.
