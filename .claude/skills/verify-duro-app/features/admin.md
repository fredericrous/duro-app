# admin

Route: `/admin/identities`

## Sub-features

- Identities (`/admin/identities`): users and principals in one table
  (Alice, Bob, dev). `/admin/users` and `/admin/principals` redirect
  here.
- Applications (`/admin/applications`, `/admin/applications/:id`).
- Access requests, grants, group mappings, invitations, audit, plugins,
  recovery: the other entries of the admin side navigation.
- Wide screens open a row in a side detail panel; narrow ones navigate
  to the detail route.

## How to get to it

Open `/admin`: the dev user is in `lldap_admin`, so admin is allowed.

## Driving it

1. At 1280x800, list the identities table rows (name, email) and the
   admin side navigation entries.
2. Click the row for Alice. Does a detail panel open beside the table
   (wide), and what does it show? Close it.
3. Open `/admin/applications`. List the application rows. Click
   Jellyfin: the final URL and what the detail shows.
4. At 390x844, click a row in `/admin/identities`: does it navigate to
   a detail route instead of a panel? Report the final URL.

## Gotchas

- `/admin/users` and `/admin/principals` answer 301 to identities on
  purpose.
- Plugins and group sync call LLDAP and the operator in production;
  locally they point at a dead port, so their sync actions fail with a
  message. That is expected; an unhandled error page is not.
- The wide-or-narrow choice is admin's own `isWide`, not the shell's
  container query.
