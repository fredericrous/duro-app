import "@testing-library/jest-dom/vitest"
import "./rsd-mock"
import "~/lib/i18n.setup"
import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

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

afterEach(() => {
  cleanup()
})
