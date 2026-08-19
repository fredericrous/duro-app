# duro-app

React Router 7 (SSR) + Effect + react-strict-dom access-governance app.
Package manager: npm. Scripts: `dev`, `build`, `typecheck`, `test`, `lint`,
`format`.

## Duro design system (@duro-app/ui v1)

Machine-queryable docs — run once per session:
`npx @duro-app/cli manifest --json`
Then: `npx @duro-app/cli <Component>` (props+usage) ·
`npx @duro-app/cli <recipe> --source-only` · `npx @duro-app/cli spacing|icons|rules` ·
free text (e.g. `npx @duro-app/cli "tags that wrap"`) searches usage metadata.
MCP server: `claude mcp add duro -- npx -y -p @duro-app/cli -p @modelcontextprotocol/sdk duro mcp`

Lint: `@duro-app/eslint-config` (shared duro-stack flat config — `react` +
`effect` + `tests` presets) enforces the critical rules (html.\* elements,
deep token imports, form kit over bare `html.input`, no deprecated Table
parts; warns on raw px/hex with token equivalents and on `flexGrow` in
`css.create`), the UI-library policy (`@duro-app/ui` only; `@effect/sql`
not Kysely; `@effect/opentelemetry` via subpath), and accessibility-first
test selectors (no `getByTestId`). Errors gate at commit (amont) and CI;
warnings inform — severity is the gate, never `--max-warnings`.

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
