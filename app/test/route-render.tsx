import { render, type RenderOptions } from "@testing-library/react"
import { MemoryRouter, Route, Routes } from "react-router"
import { type ReactElement, type ReactNode } from "react"

/**
 * Render a route component inside a MemoryRouter so hooks like `useLocation`,
 * `useNavigate`, `useSearchParams`, and `<Link>` work without an outer
 * RouterProvider.
 *
 * React Router v7 generated route components receive `loaderData` (and
 * sometimes `actionData`) as props at runtime. Tests pass these directly
 * rather than wiring a real router-loader graph.
 *
 * Note: hooks that read from RouterProvider's data context — primarily
 * `useLoaderData` and `useRouteLoaderData` — are NOT populated by
 * `MemoryRouter`. Tests for routes that call those hooks should either
 *
 *   (a) pass the data as a prop to the component instead of reading it via
 *       hook (works for `loaderData` since it's a real prop on Route
 *       components), or
 *   (b) `vi.mock("react-router", …)` to stub `useRouteLoaderData` for the
 *       specific test file.
 *
 * Pattern proven in `app/components/ButtonLink/ButtonLink.test.tsx` (mocks
 * `react-router` to stub `Link`).
 */
export interface RenderRouteOptions extends RenderOptions {
  /** Initial URL (default "/"). Use to seed query params or path params. */
  url?: string
  /** Extra entries for the in-memory history (e.g. for back/forward tests). */
  initialEntries?: string[]
  /** Wrap the component in additional providers (i18n is already loaded globally). */
  wrap?: (children: ReactNode) => ReactNode
}

export function renderRoute(ui: ReactElement, options: RenderRouteOptions = {}) {
  const { url = "/", initialEntries, wrap, ...rest } = options
  const entries = initialEntries ?? [url]
  return render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={entries}>
        <Routes>
          <Route path="*" element={wrap ? <>{wrap(children)}</> : <>{children}</>} />
        </Routes>
      </MemoryRouter>
    ),
    ...rest,
  })
}
