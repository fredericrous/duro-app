import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { t } from "~/test/test-utils"
import { ErrorBoundary } from "./auth.callback"

describe("auth.callback ErrorBoundary", () => {
  it("renders a friendly sign-in error with a retry link (not a raw error)", () => {
    render(<ErrorBoundary />)
    expect(screen.getByRole("heading", { name: t("authError.title") })).toBeInTheDocument()
    expect(screen.getByText(t("authError.message"))).toBeInTheDocument()
    const retry = screen.getByRole("link", { name: t("authError.retry") })
    expect(retry).toHaveAttribute("href", "/")
  })
})
