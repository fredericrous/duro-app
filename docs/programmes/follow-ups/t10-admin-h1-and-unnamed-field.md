+++
type = "task"
mode = "afk"
status = "open"
blocked_by = []
repos = ["duro-app"]
+++

# Admin pages: no h1, and an unnamed form field on identities

## Question

Found while closing [t04](t04-settings-admin-a11y-findings.md) on
2026-11-20. No admin route renders a level-1 heading (the settings layout
now gives each settings page one), and a fresh load of
`/admin/identities` logs the Chrome issue "A form field element should
have an id or name attribute" (count 1). Which element is it, and should
the admin layout name each page the way settings does?

## Look at

- `app/routes/admin.tsx` (the layout) and `app/routes/settings.tsx` (the
  visually hidden `h1` pattern t04 added).
- The identities page's form fields; the select-all and row checkboxes
  are the first suspects.
- Reproduce with `verify-duro-app`: `brief … admin`, and read the
  console's `[issue]` entries.

## Answer looks like

One duro-app PR: each admin page has one `h1`, the unnamed field is named
(or the design system issue filed if it is the component's), each with a
test.
