+++
type = "task"
mode = "afk"
status = "closed"
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

## Resolution

Task, 2026-11-20. Fixed on `fix/admin-h1-unnamed-field`.

- **h1.** The admin layout now gives each page one visually hidden
  `h1`, named after its rail item, the same pattern the settings layout
  uses. Detail routes keep their collection's name in the `h1` and their
  record's name in the visible `h2`. Group mappings is not on the rail,
  but it gets its own title. Anything else falls back to "Admin".
  `admin.test.tsx` checks there is exactly one `h1`. The dev server's
  HTML shows a single `h1` on `/admin` (Dashboard), on identities,
  grants, applications, access requests, audit, plugins and group
  mappings, and on `/admin/grants/new` (Grants).
- **The unnamed field is the design system's.** `/admin/identities`
  has 6 inputs with no `id` or `name`: 4 checkboxes, 1 switch and the
  name filter's `Combobox.Input`. Chrome counts 1. Its audit leaves out
  checkboxes and switches, which autofill never fills, so the one left
  is the combobox's visible text field. This is inferred from the
  counts, not isolated in a browser. `Combobox.Input` accepts only
  `placeholder` and `children`, and `Root`'s `name` goes to the hidden
  input, so the app cannot name the visible one. Filed as
  greenharness/greenrack#203; it is unfixed on greenrack `main` too.
  No app test covers it: the fix and its test belong to the design
  system.
- **Seen, not followed.** `/admin/group-mappings` logs the same Chrome
  issue (count 4).
