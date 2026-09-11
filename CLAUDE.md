# duro-app

React Router (framework mode, SSR) + Effect + react-strict-dom
access-governance app.
Package manager: npm. Scripts: `dev`, `build`, `typecheck`, `test`, `lint`,
`format`.

## Architecture decisions

Not restated here. They are vendored from the fleet corpus and the session
hook prints the current ones; ask for any of them by name:

```console
$ aval resolve ui.design-system --scope duro-stack
$ aval heads
```

Which UI library, which config enforces it, which SQL layer, which effects
runtime and web framework — all decided there, once, and this repository keeps
no records of its own. A local record deciding one of those slots is a
contradiction, not a preference: change it in
[`fredericrous/decisions`](https://github.com/fredericrous/decisions) and run
`aval add github:fredericrous/decisions` here.

## Duro design system

Machine-queryable docs — run once per session:
`npx @duro-app/cli manifest --json`
Then: `npx @duro-app/cli <Component>` (props+usage) ·
`npx @duro-app/cli <recipe> --source-only` · `npx @duro-app/cli spacing|icons|rules` ·
free text (e.g. `npx @duro-app/cli "tags that wrap"`) searches usage metadata.
MCP server: `claude mcp add duro-ds -- npx -y -p @duro-app/cli -p @modelcontextprotocol/sdk duro mcp`
— tools `duro_ds_lookup` / `duro_ds_list` / `duro_ds_manifest`. Name it `duro-ds`, not
`duro`: this repo's own `.mcp.json` already registers a `duro` server (the LLDAP identity
admin one, `duro_list_groups` and friends), which is unrelated. The `duro_ds_` prefix
arrived in `@duro-app/cli` v2 — an unpinned `npx` resolves to it, while the UI deps below
stay on 1.x.

Lint: the shared duro-stack flat config (`react` + `effect` + `tests`
presets) enforces the critical rules (html.\* elements, deep token imports,
form kit over bare `html.input`, no deprecated Table parts; warns on raw
px/hex with token equivalents and on `flexGrow` in `css.create`), the
UI-library and SQL-layer policies, `@effect/opentelemetry` via subpath, and
accessibility-first test selectors (no `getByTestId`). Errors gate, warnings
inform — severity is the gate, never `--max-warnings`.

v1 notes: Icon/StatusIcon `size` is a token (`sm|md|lg|xl|xxl` = 16/18/24/36/48px);
Dialog/Drawer/DetailPanel `closeAnimationDuration` is a motion token
(`instant|fast|base|slow`); `Table.HeaderCell` no longer takes `isActions`
(the Cell-level `isActions` is unchanged and still correct).

### App-specific conventions

- `app/components/Icon.tsx` is a **local** component that renders raw SVG
  markup from the app catalog and takes a numeric `size`. It is not
  `Icon` from `@duro-app/ui` — don't apply the v1 size-token migration to it.
- react-strict-dom's `html.form` accepts neither `method`, `action`, nor
  `onSubmit`. Use React Router's `<Form>` / `<fetcher.Form>` for every form.
- rsd's click event has no `currentTarget`; reach the DOM node through a `ref`.
- rsd has no `title` prop — use `Tooltip.Root` + `Tooltip.Trigger` instead.
- The lint config scopes the duro preset out of `app/**/*.test.tsx` (throwaway
  DOM fixtures) and `app/lib/emails/**` (react-email, where rsd never runs),
  and allows the document-shell tags plus `details`/`summary`/`canvas`.
