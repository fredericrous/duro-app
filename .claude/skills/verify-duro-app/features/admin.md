# admin

Route: `/admin/identities`

## Sub-features

- Identities (`/admin/identities`): users and groups in one sortable
  table (seeded: Alice, Bob, dev and 4 groups, 7 rows).
  `/admin/users` and `/admin/principals` redirect here.
- Applications (`/admin/applications`): a row opens the full detail
  route `/admin/applications/<id>`.
- The other entries of the admin side navigation, among them Dashboard
  (`/admin`), User Invites, access requests, grants, invitations,
  audit, Authz Playground, plugins and recovery. Group mappings
  (`/admin/group-mappings`) is a route, but it was not in the
  navigation on 2026-11-19 (`admin.tsx` maps it, likely behind a
  condition).

## How to get to it

Open `/admin`: the dev user is in `lldap_admin`, so admin is allowed.

## Driving it

1. At 1280x800, list the identities table rows (name, type) and the
   admin side navigation entries. Click a column header: does the order
   change?
2. Report every visible text that looks like a translation key (all
   capitals with dots, such as `ADMIN.COLS.NAME`) and where it is.
3. Open `/admin/applications`. List the application rows. Click
   Jellyfin: report the final URL and the detail page's heading.
4. At 390x844, open `/admin/identities`: is the side navigation
   replaced by a Menu button, and is the table readable without
   horizontal page scroll?

## Gotchas

- No admin page opens a side detail panel today: `admin.tsx` offers
  `showDetail` (a panel when wide, a route when narrow), and no route
  calls it. A row click on identities does nothing, by design for now.
- The first visit to each new route after Launch, not only the first
  page, can crash once with "Invalid hook call" or "reading
  'useContext'": vite finds a client dependency late and re-optimises.
  `/admin/applications/<id>` does it. Reload once, ignoring the cache;
  the same error after that reload is a defect.
- Raw translation keys (`ADMIN.COLS.NAME`) were seen once on
  2026-11-19, on a page that had just hit the "Invalid hook call"
  crash, and not on a clean load. `admin.cols.name` exists in `en`:
  report any you see, never treat them as expected.
- `/admin/users` and `/admin/principals` answer 301 to identities on
  purpose.
- Plugins and group sync call LLDAP and the operator in production;
  locally they point at a dead port, so their sync actions fail with a
  message. An unhandled error page is a defect.
