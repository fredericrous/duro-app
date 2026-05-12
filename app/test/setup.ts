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
