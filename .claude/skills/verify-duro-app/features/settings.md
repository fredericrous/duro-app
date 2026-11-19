# settings

Route: `/settings`

## Sub-features

- General (`/settings`): the signed-in user's settings. It does not
  show the email.
- Side navigation: General, Activity, API keys, Git access, Security
  (`/settings`, `/settings/activity`, `/settings/api-keys`,
  `/settings/git`, `/settings/security`). Git access and Security are
  shown only when their feature is configured; both are locally.
- API keys (`/settings/api-keys`): a card list of keys, and creating a
  key.
- On a narrow screen the navigation moves into a Menu drawer.

## How to get to it

Open `/settings`, or the "Welcome, dev" menu in the header.

## Driving it

1. At 1280x800, list the side navigation entries in order and the
   General page's headings.
2. Click each side navigation entry. For each, report the final URL,
   the page heading, and whether an error card shows.
3. On API keys, list the buttons and the key cards.
4. At 390x844, open the Menu drawer, then close it with Escape. Does
   focus return to the Menu button?

## Gotchas

- Git access shows an error card locally: the git server is a dead
  port. That is expected. A blank page or an unhandled error is not.
- `/settings/certificate` is a route but has no navigation entry.
- `AppShell` collapses on its container, not on the viewport: measure
  at 390 px, not by shrinking a wide window by a few pixels.
- "Invalid hook call", "Cannot read properties of null (reading
  'useContext')" or "Application Error!" is a defect on any visit, the
  first after Launch included: vite pre-bundles every client dependency
  at startup (t01, 2026-11-20). Report it; never reload it away.
