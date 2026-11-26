+++
type = "task"
mode = "afk"
status = "open"
due = "2026-12-05"
blocked_by = []
repos = ["duro-app", "homelab"]
+++

# TLS verification is off in every duro process

## Question

The chart's shared env sets `NODE_TLS_REJECT_UNAUTHORIZED: "0"` for the web
pods and duro-worker alike. That turns off certificate checks for every
outbound TLS connection the process opens, HTTPS and SMTP on 465 alike.
Among them are the NAS Vault calls that carry the duro-pki token (issue,
revoke, and now the CRL publisher), plus LLDAP, the operator, Forgejo, OIDC
and mail to `stalwart-mail-external`. Which calls still need it? Can the flag go, with
the internal CA trusted through `NODE_EXTRA_CA_CERTS` instead?

## Look at

- `chart/duro-app/values.yaml:32` (`env.NODE_TLS_REJECT_UNAUTHORIZED`), and
  `internalCA` (mounted at `/certs/ca.crt` when enabled).
- The homelab values in `kubernetes/homelab/apps/duro/helm-release.yaml`:
  which CA secret `duro-internal-ca` holds, and whether it covers NAS Vault's
  certificate (`wget` in the worker pod fails `certificate verify failed`
  against `NAS_VAULT_ADDR`, so the image's system store does not).
- Every outbound base URL the app reads (`verify-duro-app`'s classified env
  list names them), plus SMTP (`SMTP_HOST`/`SMTP_PORT`, values.yaml:33-34),
  which is not a base URL.

## Answer looks like

Each outbound endpoint listed with the CA that signs it. Then a staged PR:

- render `NODE_EXTRA_CA_CERTS=/certs/ca.crt` (or a bundle that covers every
  endpoint) inside the `internalCA.enabled` block of both deployment
  templates;
- move the flag to `worker.env` first, and check that `crl: published` keeps
  appearing;
- then drop it from the shared env, so the web pods follow.

Rollback is reverting the values change. It is proven live, with
verification on: the worker's next `crl: published`, a cert issue, an admin
revoke, an OIDC login, and one sent mail (an invite).

Found 2026-11-26 while checking the Phase 2 gates of
`docs/plans/2026-11-25-gateway-enforces-client-cert-revocation.md`.
