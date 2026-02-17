import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { MemoryRouter } from "react-router"
import { ButtonLink } from "./ButtonLink"

describe("ButtonLink", () => {
  it("renders a link with primary variant by default", () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/dashboard">Go Home</ButtonLink>
      </MemoryRouter>,
    )
    const link = screen.getByRole("link", { name: "Go Home" })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute("href", "/dashboard")
  })

  it("renders ghost variant when specified", () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/back" variant="ghost">Back</ButtonLink>
      </MemoryRouter>,
    )
    const link = screen.getByRole("link", { name: "Back" })
    expect(link).toBeInTheDocument()
  })

  it("applies small size class", () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/small" size="small">Small Link</ButtonLink>
      </MemoryRouter>,
    )
    const link = screen.getByRole("link", { name: "Small Link" })
    expect(link).toBeInTheDocument()
  })

  it("merges custom className", () => {
    render(
      <MemoryRouter>
        <ButtonLink to="/custom" className="extra-class">Custom</ButtonLink>
      </MemoryRouter>,
    )
    const link = screen.getByRole("link", { name: "Custom" })
    expect(link.className).toContain("extra-class")
  })
})
