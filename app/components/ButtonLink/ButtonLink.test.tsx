import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"

vi.mock("expo-router", () => ({
  Link: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}))

import { ButtonLink } from "./ButtonLink"

describe("ButtonLink", () => {
  it("renders a link with primary variant by default", () => {
    render(<ButtonLink href={"/dashboard" as any}>Go Home</ButtonLink>)
    const link = screen.getByRole("link", { name: "Go Home" })
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute("href", "/dashboard")
  })

  it("renders ghost variant when specified", () => {
    render(
      <ButtonLink href={"/back" as any} variant="ghost">
        Back
      </ButtonLink>,
    )
    const link = screen.getByRole("link", { name: "Back" })
    expect(link).toBeInTheDocument()
  })

  it("applies small size", () => {
    render(
      <ButtonLink href={"/small" as any} size="small">
        Small Link
      </ButtonLink>,
    )
    const link = screen.getByRole("link", { name: "Small Link" })
    expect(link).toBeInTheDocument()
  })
})
