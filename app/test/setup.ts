import "@testing-library/jest-dom/vitest"
import "./rsd-mock"
import "~/lib/i18n.setup"
import { afterAll, afterEach, beforeAll } from "vitest"
import { cleanup, configure } from "@testing-library/react"
import { server } from "./msw-server"

// Component-render tests drive a React Router `createRoutesStub`, whose loader
// resolves asynchronously — so assertions wait for the first paint via
// `waitFor`/`findBy`. Testing Library's default async timeout is 1000ms, which
// is comfortably met in isolation (~hundreds of ms) but gets starved when the
// full suite runs the jsdom + PGlite workers in parallel, surfacing as flaky
// `waitFor` timeouts (admin.grants, admin.applications, …). Raise the cap:
// `waitFor` still resolves the instant its condition holds, so green tests
// aren't slowed — only the worst-case ceiling moves. The per-test timeout
// (vitest.config.ts `testTimeout: 30000`) is kept above this so a genuine hang
// still surfaces waitFor's descriptive error rather than a bare test-timeout.
// Paired with a bounded CI-only `retry` (vitest.config.ts) that reruns a test
// starved past this ceiling — the two together are the generic starvation cure.
configure({ asyncUtilTimeout: 8000 })

// jsdom doesn't ship ResizeObserver. @duro-app/ui's ScrollArea (and any DS
// component that observes element resizes) crashes without it. A no-op
// polyfill is enough — tests don't assert on resize-driven behaviour.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

// jsdom doesn't ship matchMedia. `useMediaQuery` (used by the admin layout
// for wide-vs-narrow split) calls window.matchMedia synchronously during
// render; without this stub it throws. The stub always reports a match so
// the admin layout renders its wide variant in tests — the narrow variant
// is exercised explicitly via overrides where it matters.
if (typeof window !== "undefined" && typeof window.matchMedia === "undefined") {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// Central MSW server: defaults live in msw-server.ts, tests override per
// case via `server.use(...)`. Listening here (not per file) means individual
// test files don't have to bootstrap MSW. `onUnhandledRequest: "error"`
// turns any unexpected fetch into a loud failure so silent network access
// can't sneak past the test suite.
beforeAll(() => server.listen({ onUnhandledRequest: "error" }))
afterEach(() => {
  server.resetHandlers()
  cleanup()
})
afterAll(() => server.close())
