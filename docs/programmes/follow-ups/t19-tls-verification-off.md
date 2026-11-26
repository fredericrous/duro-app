+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
repos = ["duro-app", "homelab"]
+++

# TLS verification is off in every duro process

## Question

The chart's shared env sets `NODE_TLS_REJECT_UNAUTHORIZED: "0"` for the web
pods and duro-worker alike. That turns off certificate checks for every
outbound HTTPS call. Among them are the NAS Vault calls that carry the
duro-pki token (issue, revoke, and now the CRL publisher), plus LLDAP, the
operator, Forgejo and OIDC. Which calls still need it? Can the flag go, with
the internal CA trusted through `NODE_EXTRA_CA_CERTS` instead?

## Look at

- `chart/duro-app/values.yaml:32` (`env.NODE_TLS_REJECT_UNAUTHORIZED`), and
  `internalCA` (mounted at `/certs/ca.crt` when enabled).
- The homelab values in `kubernetes/homelab/apps/duro/helm-release.yaml`:
  which CA secret `duro-internal-ca` holds, and whether it covers NAS Vault's
  certificate (`wget` in the worker pod fails `certificate verify failed`
  against `NAS_VAULT_ADDR`, so the image's system store does not).
- Every outbound base URL the app reads (`verify-duro-app`'s classified env
  list names them).

## Answer looks like

Each outbound endpoint listed with the CA that signs it. Then a PR that drops
the flag and sets `NODE_EXTRA_CA_CERTS=/certs/ca.crt`, or a bundle that
covers them all. It is proven live: the worker's next `crl: published`, a
cert issue and an admin revoke all succeed with verification on.

Found 2026-11-26 while checking the Phase 2 gates of
`docs/plans/2026-11-25-gateway-enforces-client-cert-revocation.md`.
