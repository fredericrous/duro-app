+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
repos = ["duro-app", "homelab"]
+++

# Offer renewal to a user whose cert expired

## Question

A user whose client cert has expired, but which the CA still signs and does
not list as revoked, gets a TLS refusal and no way back short of an admin.
Could duro recognise that cert and offer the renew workflow?

The gateway refuses expired certs during the handshake, so this needs a
dedicated listener that ignores certificate dates but still checks the CRL: a
cert that is both revoked and expired gets no offer. Every other listener
keeps `optional: false` and its date check.

Holding the expired key must never be enough on its own. Otherwise a key
leaked from a lost device renews itself forever, and the CRL never catches
it, because every new serial starts out unrevoked. The renewal on that
listener also needs a fresh OIDC login as the same user, and it is offered
only within a cap after expiry (30 days unless the answer argues for
another).

Start after Phase 5 of
`docs/plans/2026-11-25-gateway-enforces-client-cert-revocation.md`
(enforcement on every listener).

## Look at

- Envoy Gateway's ClientTrafficPolicy `tls.clientValidation`: whether it
  exposes Envoy's `allow_expired_certificate`, and whether that combines with
  `crl.refs` on one listener.
- `kubernetes/homelab/security/configs/kyverno-policies/generate-mtls-client-traffic-policy.yaml`
  (the per-listener CTP data after Phase 5).
- duro's renewal path: `renewed_from_serial` in `CertificateRepo.server.ts`
  and the settings cert flow, plus how duro would tell the presented
  serial's state apart from the forwarded client-cert header.

## Answer looks like

Yes or no on Envoy Gateway support, with the CTP field or the gap named. If
yes, a sketch of the listener (host, CTP, CRL ref) and of the duro route that
reads the presented serial. It offers renewal only to an unrevoked cert of a
known user that expired within the cap, and only after a fresh OIDC login as
that user. Both checks are named, with the test that proves each.

Filed 2026-11-26 from the cert-revocation Phase 1 session's inbox.
