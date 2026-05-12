import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { AppSearchBar, AppSearchBarSkeleton } from "./AppSearchBar"

const chips = [
  { value: "media", label: "Media", count: 8 },
  { value: "tools", label: "Tools", count: 3 },
  { value: "ai", label: "AI" }, // count omitted on purpose
]

describe("AppSearchBar", () => {
  function renderBar(overrides: Partial<Parameters<typeof AppSearchBar>[0]> = {}) {
    const props = {
      query: "",
      onQueryChange: vi.fn(),
      chips,
      selected: [] as readonly string[],
      onSelectedChange: vi.fn(),
      placeholder: "Search apps…",
      clearLabel: "Clear search",
      ...overrides,
    }
    const result = render(<AppSearchBar {...props} />)
    return { ...result, props }
  }

  it("renders the input with placeholder and current value", () => {
    renderBar({ query: "jelly" })
    const input = screen.getByPlaceholderText("Search apps…") as HTMLInputElement
    expect(input).toBeInTheDocument()
    expect(input.value).toBe("jelly")
  })

  it("calls onQueryChange when user types", async () => {
    const user = userEvent.setup()
    const { props } = renderBar()
    const input = screen.getByPlaceholderText("Search apps…")
    await user.type(input, "p")
    expect(props.onQueryChange).toHaveBeenCalledWith("p")
  })

  it("does not render the clear button when query is empty", () => {
    renderBar({ query: "" })
    expect(screen.queryByText("Clear search")).not.toBeInTheDocument()
  })

  it("renders the clear button when query is non-empty and clears on click", async () => {
    const user = userEvent.setup()
    const { props } = renderBar({ query: "plex" })
    const clearBtn = screen.getByRole("button", { name: "Clear search" })
    expect(clearBtn).toBeInTheDocument()
    await user.click(clearBtn)
    expect(props.onQueryChange).toHaveBeenCalledWith("")
  })

  it("renders one toggle per chip with label and count suffix", () => {
    renderBar()
    // ToggleGroup renders each Toggle as a button — aria-label carries the chip label
    expect(screen.getByRole("button", { name: "Media" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Tools" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "AI" })).toBeInTheDocument()
    // Visible count suffixes
    expect(screen.getByText("· 8")).toBeInTheDocument()
    expect(screen.getByText("· 3")).toBeInTheDocument()
    // No count suffix when count is undefined
    expect(screen.queryByText(/· 0/)).not.toBeInTheDocument()
  })

  it("fires onSelectedChange with the toggled chip when a chip is clicked", async () => {
    const user = userEvent.setup()
    const { props } = renderBar()
    await user.click(screen.getByRole("button", { name: "Media" }))
    expect(props.onSelectedChange).toHaveBeenCalledWith(["media"])
  })

  it("renders the chip group as pressed when its value is in `selected`", () => {
    renderBar({ selected: ["tools"] })
    // ToggleGroup forwards aria-pressed (typed as the underlying button)
    const toolsBtn = screen.getByRole("button", { name: "Tools" })
    expect(toolsBtn).toHaveAttribute("aria-pressed", "true")
    const mediaBtn = screen.getByRole("button", { name: "Media" })
    expect(mediaBtn).toHaveAttribute("aria-pressed", "false")
  })

  it("omits the chip row when no chips are provided", () => {
    renderBar({ chips: [] })
    // The toolbar role is the ToggleGroup root — should not render.
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument()
  })

  it("Skeleton renders fallback layout without crashing", () => {
    const { container } = render(<AppSearchBarSkeleton />)
    // Three chip placeholders + one input placeholder, all aria-hidden
    const hidden = container.querySelectorAll('[aria-hidden="true"]')
    expect(hidden.length).toBeGreaterThanOrEqual(2)
  })
})
