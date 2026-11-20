+++
type = "task"
mode = "afk"
status = "closed"
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

## Resolution

Task, 2026-11-20. Fixed on `fix/cert-toggle-updater`.

- **Source confirmed.** React's StrictMode (`app/entry.client.tsx`)
  replays a state updater during render, so the layout setters called
  from inside the `setCertPanelUserId` updater updated AdminLayout
  while AdminIdentitiesPage rendered. Without StrictMode the updater ran
  eagerly in the click handler and stayed silent. That is why a plain
  test passed until its layout was wrapped in StrictMode.
- **Fix.** `toggleCertPanel` computes the next id from
  `certPanelUserId` and calls `setCertPanelUserId`, `onOpenChange` and
  `setContent` from the handler.
- **Test.** `admin.identities.test.tsx` mounts a stateful layout under
  StrictMode (new `renderRoute` option `parentComponent`) and clicks
  Certificates twice. It is red on the old toggle and green on the new
  one. It asserts on the "Cannot update a component" message only, not
  on every console error.
- **Browser, 1280x800.** On origin/main, each page load logs the error
  once, at the first Certificates click. With the fix there is no error.
  The panel opens, closes from the row button and from its own Close
  button, reopens, and switches from Alice to Bob in place.
- **Seen, not caused by this.** While the panel is open at 1280, the
  admin rail collapses to the Menu button. Main and the fix give the
  same widths, and the rail comes back on close. Filed as
  [t13](t13-rail-collapses-with-cert-panel.md).
