import "@testing-library/jest-dom/vitest"
import "./rsd-mock"
import "~/lib/i18n.setup"
import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

afterEach(() => {
  cleanup()
})
