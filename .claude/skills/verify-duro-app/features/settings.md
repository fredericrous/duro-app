# settings

Route: `/settings`

## Sub-features

- Profile (`/settings`): name and email of the signed-in user.
- Tabs: Activity, Certificate, API keys, Git, Security
  (`/settings/<tab>`), in the side navigation of the page shell.
- API keys (`/settings/api-keys`): list and create a key.

## How to get to it

Open `/settings`, or the "Welcome, dev" menu in the header.

## Driving it

1. At 1280x800, read the profile: does it show `dev@localhost`? List
   the side navigation entries in order.
2. Click each side navigation entry. For each, the final URL and the
   page heading. Does any of them show an error card?
3. On API keys, list the buttons and the table columns.
4. At 390x844, is the side navigation replaced by a "Menu" button that
   opens a drawer? Open it and close it with Escape.

## Gotchas

- Certificate and Git talk to Vault and Forgejo in production; locally
  those point at a dead port, so an "unavailable" or empty state there
  is expected. A blank page or an unhandled error is not.
- `AppShell` collapses on its container, not on the viewport: measure
  at 390 px, not by shrinking a wide window by a few pixels.
