# home

Route: `/`

## Sub-features

- The app grid: one card per app the dev user holds a grant on (Duro,
  KB Vision, Grafana, Nextcloud, Audiobookshelf, Uptime Kuma), each
  "No launch URL configured" locally.
- The header: "Welcome, dev" menu, Devices, My requests (with a count
  badge: 1 pending), Request access.
- Category headings above the cards.

## How to get to it

Open `/`. No sign-in: the dev server is the user `dev`.

## Driving it

1. At 1280x800, list the app card titles in order and the header
   links. Does "Welcome, dev" show, and does "My requests" carry a
   count?
2. Click "Request access" in the header. Does a dialog open, listing
   apps the dev user does not hold yet? Close it with Escape: does
   focus return to the button?
3. At 390x844, does the grid stack to one column with no horizontal
   scroll (compare `document.documentElement.scrollWidth` with the
   viewport width)?

## Gotchas

- The first browser load after Launch can fail once with "Invalid hook
  call" (vite optimises client dependencies): reload once, ignoring the
  cache. A second failure is a defect.
- "No launch URL configured" is expected locally, not a defect: the
  seed gives most apps no URL.
- The badge count comes from the seed's pending requests; a request
  sent from the header dialog raises it until Cleanup.
