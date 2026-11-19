# catalog

Route: `/catalog`

## Sub-features

- Browse every enabled app with search (`/catalog?q=<text>`).
- Each app's state for the user: Open, Granted, Partial access,
  Pending, Request access (requestable), Invite only.
- For an admin, a requestable or invite-only app shows "Manage", a link
  to `/admin/applications/<id>`. For anyone else it shows a "Request
  access" button that opens the request dialog (role, justification,
  "Send request").
- `/requests`: the user's requests (the seed holds one pending,
  Immich, Editor).

## How to get to it

Open `/catalog`, or "Request access" in the header from any page.

## Driving it

1. At 1280x800, list the app names in order with their state label or
   action. Expected from the seed: 11 apps, KB Vision "Partial
   access", Grafana "Open", Immich "Pending", Jellyfin "Invite only".
2. Type "graf" in the search field. Which cards remain, and what is
   the URL? Clear the search: does the full list come back?
3. On a requestable app (Gitea, Home Assistant, Vaultwarden or
   Paperless), click "Manage". Report the final URL and the page
   heading.
4. Open `/requests`. List the rows (application, role, status).

## Gotchas

- The dev user is an admin, so the catalog's request dialog cannot be
  driven as `dev`: requestable apps show "Manage" instead. There is no
  non-admin dev sign-in; a change to the request flow is proven by the
  route's vitest tests and, in the browser, through the header's
  "Request access" dialog (see `home.md`), if it opens for an admin.
- The first browser load after Launch can fail once with "Application
  Error!" and "Invalid hook call" / "Cannot read properties of null
  (reading 'useContext')": vite optimises client dependencies on first
  use. Reload once, ignoring the cache. A second failure is a defect.
