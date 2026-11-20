+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
repos = ["duro-app"]
+++

# Cert toggle sets layout state in render

## Question

After a click on an identity's Certificates button, React logs "Cannot
update a component (AdminLayout) while rendering a different component
(AdminIdentitiesPage)" (browser check, 2026-11-20). `toggleCertPanel` in
`app/routes/admin.identities.tsx` calls the layout's `onOpenChange` and
`setContent` inside the `setCertPanelUserId` updater, which React runs
during render. Is that the source, and does moving those calls out of
the updater silence it without breaking the toggle?

## Look at

- `app/routes/admin.identities.tsx` (`toggleCertPanel`, the effect that
  calls `setContent`).
- `app/routes/admin.tsx` (`useAdminSidePanel`'s setters).

## Answer looks like

One PR where the toggle computes the next id outside the updater (or
derives open state in an effect), with a test that clicks Certificates
twice and asserts no console error, and a browser check that the panel
still opens and closes at 1280x800.
