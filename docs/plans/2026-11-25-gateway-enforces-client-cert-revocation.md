---
status: active
plan-id: p-01M8AC03KR1TV8GG3J15SZK40Z
branch: fix/cert-revocation-enforced
repos: [duro-app, homelab]
adrs: []
---

# Gateway enforces client-cert revocation, piloted by duro

## Review panel

📄 Full reviews: [2026-11-25-gateway-enforces-client-cert-revocation.reviews.md](2026-11-25-gateway-enforces-client-cert-revocation.reviews.md)
👉 **Decide:** keep duro handing the CRL over via NAS KV (as planned), or have the broker fetch Vault's public CRL directly (backend's recommendation; drops one hop and a cross-repo contract).
📍 duro-app, homelab · 5 phases · 6 PRs · 2 releases · 1 decision · 1 step for you (reissue iPhone cert) · next: Phase 1. Panel: backend, lang:go, lang:typescript, platform, tui, unix, architect, po (opus-5-5), codex.
**Changed by review:** CRL reaches main Vault via the broker, with grants on both Vaults; Phase 3 split so Vault is ready before duro publishes and alerts land after; worker gets a Service, /metrics and Vault wiring in Phase 1.
**Verdicts:** final approve (backend, architect); 6 approve-with-changes; codex rework → applied; 15 carried; words 1179 → 2039 (×1.73, mostly blocking/wrong-statement fixes); remove 0 (1 to you), merge 0.

## Picture

```
 today
 -----
 duro revoke --> Vault pki-client CRL          (nobody reads it)
 revoked cert --TLS--> Envoy [CA only] --> app   (accepted)

 after this plan
 ---------------
 duro revoke --> Vault --> duro-worker --> KV client-crl
                                              |
                                         broker (10m) + ESO (5m)
                                              v
 revoked cert --TLS--> Envoy [CA + CRL] --x refused
```

A revoked cert used to pass every gateway listener; after this plan
duro-worker publishes Vault's CRL, ESO syncs it, and Envoy refuses it.

## Context

Revoking a client cert in duro today changes only duro's DB and Vault's
`pki-client` revocation list. Envoy Gateway never reads that list, so a revoked
cert keeps passing mTLS on every host until it expires
(`docs/operations/mtls-breakglass.md:139`: "Envoy Gateway has no CRL"). Found
2026-11-25 while diagnosing the iPhone: its cert (`6f:5c:7f:04:8f`) was revoked
on 2026-09-23 and would still be accepted.

The 2026-09-23 revocation itself was **not** renewal revoking other devices
(renewal revokes only `renewed_from_serial`; the Mac cert's is null). The audit
trail has `auth.login` 16:21:33 and `cert.issued` 16:22:43 and **no
`cert.revoked`**: the revocations came through an admin revoke path, which emits
no audit event. So "fix duro's revocation first" means the real defects found:

1. Admin revoke mutations (`revokeCert`, `revokeAllCerts`, `revokeCertsBatch`,
   `revokeAllCertsBatch` in `app/lib/mutations/admin-users.ts:45-115`) write no
   audit event: who revoked what is unrecoverable.
2. Recovery with `revokeOthers` (`app/lib/workflows/recovery.server.ts:102-139`)
   only calls `revokeAllForUser`, which marks rows `pending`; it never calls
   Vault. Its comment says "completes asynchronously via the operator"; no
   operator code does. **Those certs are never revoked in Vault** — a security bug.
3. Nothing retries `pending`/`failed` revocations
   (`cert-revocation.server.ts:47-54`); only a manual button.

Decided with the person: duro-app publishes the CRL via Vault → ESO; rollout is
one pilot listener, then all except the two break-glass listeners.

## Phases

### Phase 1 — duro-app: revocation that actually happens (PR 1, release)

<!-- panel: repos=duro-app -->

Files: `app/lib/mutations/admin-users.ts`, `app/lib/workflows/recovery.server.ts`, `app/lib/workflows/cert-revocation.server.ts`, `app/lib/services/CertificateRepo.server.ts`, `app/worker/worker.ts`, `app/lib/db/migrations/pg/<next>_cert_revoke_attempts.ts` (new), their `*.test.ts`.

- Route every admin revoke through `revokeSerialForUser`
  (`app/lib/workflows/cert-revocation.server.ts:16-45`) with an
  `auditUsername`/actor, so each emits `cert.revoked` with actor id and path
  (`admin`, `self`, `recovery`, `reveal`, `user-revoke`). `revokeCert` stops
  duplicating the tapError chain.
- `app/lib/workflows/recovery.server.ts` `approveRecovery` revokeOthers: after `revokeAllForUser`, call
  `revokeSerialForUser` for each serial (as `revokeUser` does), then issue.
  Fix the misleading comment.
- `revokeAllForUser` (`app/lib/services/CertificateRepo.server.ts`): its SELECT filters
  `expires_at > NOW()` but its UPDATE does not — expired rows go `pending`
  forever. Make both use the same predicate.
- Before releasing Phase 1, in `app/worker/worker.ts` and `chart/duro-app/templates/deployment-worker.yaml`, wire VaultPki/CertManager and CertificateRepo into WorkerLayer alongside its existing AuditService and HttpClient. Verify the worker receives NAS_VAULT_ADDR and NAS_VAULT_TOKEN through its chart configuration; include any required deployment-worker.yaml changes in PR 1. Add a smoke test using the production worker layer composition that completes a failed revocation with only Phase 1 deployed.
- Revocation sweeper in duro-worker (`app/worker/worker.ts`): every 10 min,
  rows `revoke_state in ('pending','failed')` older than 2 min →
  `revokeSerialForUser`, with attempt count + backoff (new columns
  `revoke_attempts`, `revoke_next_at` via the existing migration pattern). `markRevokePending`/`revokeAllForUser` set `revoke_next_at = NOW() + 2 min`; `markRevokeFailed` increments `revoke_attempts` and sets the backoff; the sweeper selects `COALESCE(revoke_next_at, '-infinity') <= NOW()`. The migration backfills `revoke_next_at = NOW()` for rows with `revoke_state IN ('pending','failed') AND revoked_at IS NULL` (the orphaned recovery rows); a test seeds such a row with NULL `revoke_next_at` and asserts one sweep completes it.
- Tests (vitest, alongside the existing ones): recovery test at
  `app/lib/workflows/recovery.server.test.ts` asserts the Vault stub received each serial
  and rows are `completed`; admin-users tests assert an audit row per revoke;
  a sweeper test turns a `failed` row `completed`; repo test for the
  expired-row predicate.

### Phase 2 — duro-app: the CRL publisher (PR 2, release)

<!-- panel: repos=duro-app -->

Files: `app/lib/services/CrlPublisher.server.ts` (new), `app/lib/services/VaultPki.server.ts`, `app/worker/worker.ts`, `app/lib/services/CrlPublisher.server.test.ts` (new), `chart/duro-app/templates/deployment-worker.yaml`, `chart/duro-app/templates/servicemonitor-worker.yaml` (new), `package.json`.

Deploys only after both Phase 3 Vault prerequisites are verified: bootstrap NAS-auth has applied the duro-pki policy, and Flux has recreated and successfully completed the changed NAS pki-client-setup Job. With VAULT_ADDR explicitly targeting NAS Vault, verify config/crl expiry=168h and auto_rebuild=false and prove the duro-pki token can GET pki-client/crl/rotate. The bootstrap NAS-auth step does not apply CRL configuration.

New service `app/lib/services/CrlPublisher.server.ts`, run by duro-worker using the WorkerLayer services and NAS Vault credentials already deployed in Phase 1:

- In `app/lib/services/CrlPublisher.server.ts`: once at worker start (the runbook's force-publish), every 6 h, and on a 30 s tick when `max(revoked_at)` is newer than the last publish (revocations complete in the web pods, so the worker polls the DB):
  `GET pki-client/crl/rotate`, `GET pki-client/crl/pem` using `@effect/platform` HttpClient, parse it
  (new dependency `@peculiar/x509`: node-forge and `crypto.X509Certificate` cannot parse or verify a CRL), check it is signed by the `pki-client` CA and its
  `nextUpdate` > now + 3 days, then write it to NAS Vault KV
  `secret/pki/client-crl` key `ca.crl` (PEM) — only when content changed.
- Reconcile, in `app/lib/services/CrlPublisher.server.ts`: every serial with `revoke_state='completed'` and
  `expires_at > now` must appear in the CRL; a missing one is re-revoked and
  logged.
- Metrics: duro-app exports none today. Add a Prometheus `/metrics` route to the worker health server in `app/worker/worker.ts`, a Service `chart/duro-app/templates/service-worker.yaml` (new) selecting worker pods and exposing a named health port, and a ServiceMonitor `chart/duro-app/templates/servicemonitor-worker.yaml` (new) selecting that Service and port. Ensure Prometheus selects the monitor and can reach the endpoint. Gate Phase 2 on an UP worker scrape target with all four metrics present:
  `duro_crl_next_update_timestamp_seconds`, `duro_crl_published_timestamp_seconds`,
  `duro_crl_missing_serials`, `duro_revocations_pending`.

- Tests (`app/lib/services/CrlPublisher.server.test.ts`, `it.effect` + TestClock): debounce collapses bursts; a CRL with nextUpdate < 3 d or a bad signature is not written; unchanged content is not rewritten; a completed serial missing from the CRL is re-revoked.

### Phase 3 — homelab: Vault, ESO, alerts (PR 3a + PR 3b, no enforcement yet)

<!-- panel: repos=homelab -->

Two PRs. 3a, before Phase 2's release: `bootstrap/pkg/vault/nas_cluster_auth.go` and its tests, plus `kubernetes/nas/platform-foundation/vault/pki-client-setup-job.yaml`. 3b, after Phase 2's first publish shows up in NAS KV `secret/pki/client-crl`: the broker's `sync_client_crl()`, `vault-nas-roles-setup.yaml`, the ExternalSecret, the alerts and the docs. Landing 3b earlier would fire `ExternalSecretNotReady` and fail every broker run until Phase 2 ships.

Files: `bootstrap/pkg/vault/nas_cluster_auth.go`, `bootstrap/pkg/vault/nas_cluster_auth_test.go`, `bootstrap/pkg/vault/nas_root_integration_test.go`, `kubernetes/homelab/security/configs/nas-integration/nas-token-broker-cronjob.yaml`, `kubernetes/homelab/security/configs/vault-config-operator/setup-jobs/vault-nas-roles-setup.yaml`, `kubernetes/nas/platform-foundation/vault/pki-client-setup-job.yaml`, `kubernetes/homelab/security/gateways/envoy-gateway/client-crl-externalsecret.yaml` (new), `kubernetes/homelab/monitoring/configs/client-crl-alerts.yaml` (new), the `kustomization.yaml` of both directories, a promtool test file next to the rule (new), `docs/operations/mtls-breakglass.md`, `docs/operations/nas-pki-and-mtls.md`.

- `bootstrap/pkg/vault/nas_cluster_auth.go` policy `duro-pki` (live only after the bootstrap NAS-auth step re-runs, `steps/nas_vault_auth.go:99`; run it before duro's Phase 2 release and check it with `vault policy read duro-pki`): add
  `pki-client/crl/rotate` (read; the integration test must rotate with GET using the actual duro-pki token), `pki-client/crl/pem` + `pki-client/cert/ca`
  (read), `secret/data/pki/client-crl` (create/update/read). Tests: `bootstrap/pkg/vault/nas_cluster_auth_test.go` asserts the `duro-pki` policy names exactly these new paths; `nas_root_integration_test.go` asserts a `duro-pki` token can rotate the CRL and write `secret/data/pki/client-crl`, and is refused reading `secret/data/pki/client-ca`.
- `kubernetes/nas/platform-foundation/vault/pki-client-setup-job.yaml`: set
  `pki-client/config/crl expiry=168h auto_rebuild=false` explicitly (read the
  live value first: `vault read pki-client/config/crl`). 7-day CRL, 6-hourly
  rotation → ~6.75 days of slack before Envoy would refuse everyone. Reconcile config/crl on both the existing-CA path before its exit 0 and the fresh-CA path. Test a rerun against an existing CA: the configuration changes without regenerating the CA. Verify the live configuration after Flux completes the changed Job before releasing Phase 2.
- ExternalSecret `kubernetes/homelab/security/gateways/envoy-gateway/client-crl-externalsecret.yaml`, `refreshInterval: 5m`,
  key `ca.crl` from `secret/data/pki/client-crl` in the MAIN Vault (`vault-backend` reads main Vault, not NAS). Extend `kubernetes/homelab/security/configs/nas-integration/nas-token-broker-cronjob.yaml` with `sync_client_crl()` (sync_client_ca pattern, every 10 min): copy duro's validated NAS KV `secret/data/pki/client-crl` to main Vault, refusing anything that is not a PEM CRL. Grants on both sides: NAS read of `secret/data/pki/client-crl` added to policy `pki-clients-read` (role `pki-mirror`, `bootstrap/pkg/vault/nas_cluster_auth.go`, same bootstrap run as `duro-pki`; `nas_cluster_auth_test.go` asserts the path, `nas_root_integration_test.go` asserts pki-mirror reads it and cannot write it); main-Vault create/read/update/patch added to policy `nas-token-broker` in `kubernetes/homelab/security/configs/vault-config-operator/setup-jobs/vault-nas-roles-setup.yaml`.
- PrometheusRule `kubernetes/homelab/monitoring/configs/client-crl-alerts.yaml`: CRL next update
  < 4 d (warning), < 2 d (critical); published > 12 h ago; missing serials > 0;
  revocations pending > 30 min; `ExternalSecretNotReady`. For the copy Envoy
  reads: unlike the best-effort `sync_client_ca`, a `sync_client_crl()`
  failure, or a copied CRL with `nextUpdate` under 4 days, sets `success=1`
  (like `sync_service_ca`), failing the job so the existing broker-staleness
  alerts fire.
- Docs: `docs/operations/mtls-breakglass.md` and
  `docs/operations/nas-pki-and-mtls.md` rewritten to the new truth;
  a runbook "CRL stale → everyone refused" in the C4 style (numbered
  commands, each with an `# expect` line): symptom (s_client alert); check
  `kubectl -n envoy-gateway-system get secret client-crl -o jsonpath='{.data.ca\.crl}' | base64 -d | openssl crl -noout -nextupdate`;
  fix 1: restart duro-worker (it publishes at start), run the broker job
  once, force-sync the ExternalSecret; fix 2: revert the Kyverno data PR.
  duro-https/auth have no CRL and stay the way in.

### Phase 4 — homelab: pilot on stremio-server-https (PR 4)

<!-- panel: repos=homelab -->

Files: `kubernetes/homelab/security/configs/kyverno-policies/generate-mtls-client-traffic-policy.yaml`, `tests/kyverno/generated-ctp.yaml`.

- Before `kubernetes/homelab/security/configs/kyverno-policies/generate-mtls-client-traffic-policy.yaml` changes: reissue the iPhone cert from duro (the person) — its current one is
  revoked and is refused once enforcement reaches its hosts.
- `kubernetes/homelab/security/configs/kyverno-policies/generate-mtls-client-traffic-policy.yaml`:
  in `data` (match is immutable on synchronized rules), add
  `tls.clientValidation.crl.refs: [{kind: Secret, name: client-crl}]` when
  `sectionName == stremio-server-https`. Mechanism: one JMESPath expression that returns the whole `crl` object or nothing, with `onlyVerifyLeafCertificate: true`. A kyverno test proves that the other listeners' CTPs have no `crl` key. Update `tests/kyverno/generated-ctp*.yaml`.
- Verify `tests/kyverno/generated-ctp.yaml` and live (below). Hold ~24 h with the CRL rotating at least 4 times.

### Phase 5 — homelab: all listeners (PR 5)

<!-- panel: repos=homelab -->

Files: `kubernetes/homelab/security/configs/kyverno-policies/generate-mtls-client-traffic-policy.yaml`, `tests/kyverno/generated-ctp.yaml`.

- In `kubernetes/homelab/security/configs/kyverno-policies/generate-mtls-client-traffic-policy.yaml`, widen the condition to every listener except `duro-https` and
  `https-authelia` (the break-glass bundle listeners: their second root has no
  CRL, and they are the way back in). The XFCC policy is untouched.
- Update `tests/kyverno/generated-ctp.yaml`; re-run the verification on two more hosts.

## Verification

- duro-app: recovery with revokeOthers and 2 certs → the Vault stub gets 2 revoke calls and both rows are `completed`. An admin revoke → 1 `cert.revoked` audit row with the actor. A `failed` row → `completed` after one sweep. Each test fails on `origin/main`.
- Phase 2 live: worker log shows a publish; `vault kv get -field=ca.crl secret/pki/client-crl | openssl crl -noout -nextupdate -text`
  parses as a PEM CRL and lists the
  revoked serials (the iPhone's `6F:5C:7F:04:8F…` among them); metrics scrape.
- Phase 3: `kubectl -n envoy-gateway-system get secret client-crl` has `ca.crl`;
  alerts loaded (`yq '.spec' kubernetes/homelab/monitoring/configs/client-crl-alerts.yaml > /tmp/client-crl-rules.yaml && promtool check rules /tmp/client-crl-rules.yaml`; a PrometheusRule CR is not a promtool rule file; rule visible in Prometheus).
- Phase 4 gate: before merge, `client-crl` Secret exists with `ca.crl`; after Flux, `kubectl -n envoy-gateway-system get ctp mtls-stremio-server-https -o yaml` shows Accepted, and `openssl s_client` with no cert is refused.
- Phase 4 red/green loop, OpenSSL (TLS 1.3; macOS curl is LibreSSL, useless here):
  - issue a scratch cert from duro, then
    `printf 'GET / HTTP/1.1\r\nHost: %s\r\nConnection: close\r\n\r\n' "$HOST" | openssl s_client -tls1_3 -quiet -connect "$HOST:443" -servername "$HOST" -cert s.crt -key s.key 2>err.txt | head -1`
    → stdout `HTTP/1.1 200` (TLS 1.3 refuses a client cert after the handshake, so exit code and `CONNECTED` prove nothing);
  - record `ssl.fail_verify_error` on each replica (per-pod port-forward loop with readiness wait, mtls-breakglass.md:164-175);
  - revoke it in duro, run the broker job once and force-sync the ExternalSecret (mtls-breakglass.md:153), poll until the Secret's CRL lists the serial (≤ ~15 min unforced) → no status line, and `grep -E 'alert (certificate revoked|bad certificate)' err.txt` matches;
    `ssl.fail_verify_error` rose over the baseline;
  - the Mac cert still → 200; stremio-server via browser on the Mac works.
- Phase 5: same scratch loop on `stremio.daddyshome.fr` and
  `photos.daddyshome.fr`; `home.daddyshome.fr` (duro-https) and
  `auth.daddyshome.fr` keep accepting the Mac cert and are unchanged.
- Staleness alerting: `promtool test rules` cases for each threshold, with `rule_files` pointing at the `yq '.spec'` extract (a stale
  CRL cannot safely be staged on prod).

## Rollback

- Trigger: revert when a cert that is not revoked is refused (the Mac cert or a fresh scratch cert gets no `HTTP/1.1 200`), or when `duro_crl_next_update_timestamp_seconds - time() < 2d` while enforcement is live.
- Phase 4/5: `git revert` the Kyverno data PR; Kyverno synchronize regenerates the CTPs without `crl`. Faster path: the runbook route (duro-https/auth → force publish). Revocations made in between stay in Vault and the DB.

## Non-goals

- CRL for the break-glass CA; OCSP; a duro admin UI for the CRL; the
  duro-operator (no change).
- The phone today: separate from this plan — reissue its cert from duro.

## Code review

- duro-app: backend, lang:typescript, architect, platform (react, ui-design left out: no UI change)
- homelab: backend, platform, lang:go (python, typescript left out: no such file touched; unix, tui left out: no command-line output change; architect left out: config wiring only)

<!-- panel: repos=duro-app,homelab adds=contract reviewers=backend,lang:go,lang:typescript,platform,tui,unix,architect,po,codex body-sha=ac52aed08a95 -->
