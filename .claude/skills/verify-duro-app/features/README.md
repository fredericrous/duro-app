# verify-duro-app features

One file per feature. Each has a `Route:` line and a `## Driving it`
section, which `verify.py brief <pidfile> <dir> <feature>` turns into a
`browser-check` brief with the live port filled in.

| Feature                 | Route               | SSR journey | What it covers                              |
| ----------------------- | ------------------- | ----------- | ------------------------------------------- |
| [home](home.md)         | `/`                 | `home`      | app grid, header, request dialog entry      |
| [catalog](catalog.md)   | `/catalog`          | `catalog`   | browse apps and search, Manage, my requests |
| [settings](settings.md) | `/settings`         | `settings`  | profile, tabs, API keys                     |
| [admin](admin.md)       | `/admin/identities` | `admin`     | identities, applications, detail panel      |

All of them run as the dev user (`dev`, `dev@localhost`, groups
`family`, `media`, `lldap_admin`), on the in-memory store the dev server
seeds at boot (12 apps, 16 roles, 8 grants, 2 pending requests, users
Alice and Bob). A write lives until Cleanup and is gone after it.

A change elsewhere adds a feature file here and, when the page can be
checked without a browser, a journey to `JOURNEYS` in `verify.py`, in
the same pull request.
