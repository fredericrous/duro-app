import "@testing-library/jest-dom/vitest"
import "./rsd-mock"
import "~/lib/i18n.setup"
import { afterAll, afterEach, beforeAll } from "vitest"
import { cleanup } from "@testing-library/react"
import { server } from "./msw-server"

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
