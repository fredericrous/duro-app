import { render } from "@testing-library/react"
import { createRoutesStub, Outlet, useLoaderData } from "react-router"

/**
 * Component-render harness using React Router v7's `createRoutesStub`.
 *
 * Replaces hand-built `createMemoryRouter` setups: the stub provides a real
 * data router, so `useLoaderData`, `useRouteLoaderData`, `useFetcher`, and
 * `useRevalidator` all resolve natively without `vi.mock("react-router")`.
 *
 * Usage:
 *   renderRoute({
 *     route: { path: "/catalog", Component: CatalogPage, loader: () => fixture },
 *     parentLoaderId: "routes/dashboard",   // for useRouteLoaderData("routes/dashboard")
 *     parentLoader: () => ({ user: "alice", isAdmin: false }),
 *     url: "/catalog?q=jelly",
 *   })
 *
 * The route's Component receives loaderData as a prop (matching React
 * Router's framework-mode generated route shape).
 */

export interface RenderRouteOptions {
  /** The route under test. Provide a loader that returns fixture data; the
   *  route's `Component` will receive it as `loaderData` via the prop. */
  route: {
    path: string
    Component: React.ComponentType<{ loaderData: never }>
    loader?: () => unknown
    action?: (args: { request: Request }) => unknown
  }
  /** Optional parent route — populates `useRouteLoaderData(parentLoaderId)`. */
  parentLoaderId?: string
  parentLoader?: () => unknown
  /** Outlet context the parent passes to the child route — populates
   *  `useOutletContext()`. Use for admin routes that consume
   *  `useAdminSidePanel()`. */
  parentContext?: unknown
  /** Optional child routes (e.g. `/api/catalog` for fetcher.load). */
  children?: Array<{ path: string; loader?: () => unknown; action?: (args: { request: Request }) => unknown }>
  /** Initial URL the router opens at. Defaults to the route's path. */
  url?: string
}

export function renderRoute(options: RenderRouteOptions) {
  const { route, parentLoaderId, parentLoader, parentContext, children = [], url } = options

  // Component wrapper: read loaderData via the hook and forward as a prop.
  // Mirrors React Router v7's framework-mode contract — generated route
  // Components receive loaderData this way in production.
  const ComponentWithLoaderData = () => {
    const loaderData = useLoaderData() as never
    return <route.Component loaderData={loaderData} />
  }

  // Strip leading "/" so the child paths are relative to the parent. A "/"
  // route under test means "the parent's index" — represent that with
  // `index: true` (createRoutesStub rejects empty-string paths).
  const stripPath = (p: string) => p.replace(/^\//, "")
  const childRouteUnderTest =
    route.path === "/" || route.path === ""
      ? {
          index: true as const,
          loader: route.loader,
          action: route.action,
          Component: ComponentWithLoaderData,
        }
      : {
          path: stripPath(route.path),
          loader: route.loader,
          action: route.action,
          Component: ComponentWithLoaderData,
        }

  const Stub = createRoutesStub([
    {
      id: parentLoaderId,
      path: "/",
      loader: parentLoader,
      // Parent component must render <Outlet /> so the child (route under
      // test) actually paints. Pass `parentContext` through so the child can
      // read it via `useOutletContext()` (admin routes consume the
      // AdminSidePanel context this way).
      Component: () => <Outlet context={parentContext} />,
      children: [
        childRouteUnderTest,
        ...children.map((c) =>
          c.path === "/" || c.path === ""
            ? { index: true as const, loader: c.loader, action: c.action }
            : { path: stripPath(c.path), loader: c.loader, action: c.action },
        ),
      ],
    },
  ] as never)

  return render(<Stub initialEntries={[url ?? route.path]} />)
}
