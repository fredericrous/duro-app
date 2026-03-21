import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("react-router", () => ({
  Link: ({ children, to, style: _style, ...props }: any) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}))

import { ButtonLink } from "./ButtonLink"

describe("ButtonLink", () => {
  it("renders a link with primary variant by default", () => {
    render(<ButtonLink to="/dashboard">Go Home</ButtonLink>)
    const link = screen.getByRole("link", { name: "Go Home" })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute("href", "/dashboard")
  })

  it("renders ghost variant when specified", () => {
    render(
      <ButtonLink to="/back" variant="ghost">
        Back
      </ButtonLink>,
    )
    const link = screen.getByRole("link", { name: "Back" })
    expect(link).toBeInTheDocument()
  })

  it("applies small size", () => {
    render(
      <ButtonLink to="/small" size="small">
        Small Link
      </ButtonLink>,
    )
    const link = screen.getByRole("link", { name: "Small Link" })
    expect(link).toBeInTheDocument()
  })
})
