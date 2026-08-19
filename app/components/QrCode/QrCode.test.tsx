import { describe, expect, it } from "vitest"
import { render, screen } from "@testing-library/react"
import { QrCode } from "./QrCode"

describe("QrCode", () => {
  it("renders a labelled, scalable SVG for the value", () => {
    render(<QrCode value="https://example.com/cert/tok123" label="Claim link QR" size={200} />)
    const svg = screen.getByRole("img", { name: "Claim link QR" })
    expect(svg.tagName.toLowerCase()).toBe("svg")
    expect(svg).toHaveAttribute("width", "200")
    // a real matrix produced dark modules
    const path = svg.querySelector("path")
    expect(path?.getAttribute("d")?.length ?? 0).toBeGreaterThan(100)
  })

  it("is deterministic for the same value", () => {
    const { container: a } = render(<QrCode value="same" label="a" />)
    const { container: b } = render(<QrCode value="same" label="b" />)
    expect(a.querySelector("path")?.getAttribute("d")).toBe(b.querySelector("path")?.getAttribute("d"))
  })
})
