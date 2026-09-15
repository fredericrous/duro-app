import { describe, expect, it } from "vitest"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useLocation, useNavigate } from "react-router"
import { SideNav } from "@duro-app/ui"
import { renderRoute } from "~/test/render-route"
import { AppShell, type AppShellNavProps } from "./AppShell"

/** A two-destination shell: the nav navigates AND reports the selection. */
function Fixture() {
  const navigate = useNavigate()
  const location = useLocation()
  const nav = ({ onSelect }: AppShellNavProps) => (
    <SideNav.Root
      value={location.pathname === "/one/two" ? "two" : "one"}
      onValueChange={(value) => {
        navigate(value === "two" ? "/one/two" : "/one")
        onSelect()
      }}
    >
      <SideNav.Section label="Places">
        <SideNav.Item value="one">One</SideNav.Item>
        <SideNav.Item value="two">Two</SideNav.Item>
      </SideNav.Section>
    </SideNav.Root>
  )
  return (
    <AppShell
      header={<span>Header</span>}
      nav={nav}
      navTitle="Navigation"
      menuLabel="Menu"
      closeLabel="Close navigation"
      aside={<aside aria-label="Detail">Panel</aside>}
    >
      <p>Content at {location.pathname}</p>
    </AppShell>
  )
}

function renderShell(initialPath = "/one") {
  // A splat keeps the fixture mounted for both destinations: the stub mounts
  // extra `children` as component-less siblings, not under the route.
  return renderRoute({
    route: { path: "/one/*", Component: Fixture },
    url: initialPath,
  })
}

describe("AppShell", () => {
  it("renders the rail, the content and the aside beside the page, no drawer", () => {
    renderShell()
    expect(screen.getByRole("navigation")).toBeInTheDocument()
    expect(screen.getByText("Content at /one")).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    // The aside sits outside the page, not inside the routed content.
    const main = screen.getByRole("main")
    expect(within(main).queryByLabelText("Detail")).not.toBeInTheDocument()
    expect(screen.getByLabelText("Detail")).toBeInTheDocument()
  })

  it("the Menu button opens the drawer with a second copy of the nav", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("button", { name: "Menu" }))
    const dialog = await screen.findByRole("dialog", { name: "Navigation" })
    expect(within(dialog).getByRole("navigation")).toBeInTheDocument()
    expect(screen.getAllByRole("navigation")).toHaveLength(2)
    expect(within(dialog).getByRole("button", { name: "Close navigation" })).toBeInTheDocument()
  })

  it("selecting a destination closes the drawer and navigates", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("button", { name: "Menu" }))
    const dialog = await screen.findByRole("dialog", { name: "Navigation" })
    await user.click(within(dialog).getByRole("button", { name: "Two" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.getByText("Content at /one/two")).toBeInTheDocument()
  })

  it("re-selecting the current destination closes the drawer even though the route does not change", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("button", { name: "Menu" }))
    const dialog = await screen.findByRole("dialog", { name: "Navigation" })
    await user.click(within(dialog).getByRole("button", { name: "One" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.getByText("Content at /one")).toBeInTheDocument()
  })

  it("the close button closes the drawer", async () => {
    const user = userEvent.setup()
    renderShell()
    await user.click(screen.getByRole("button", { name: "Menu" }))
    await screen.findByRole("dialog", { name: "Navigation" })
    await user.click(screen.getByRole("button", { name: "Close navigation" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })
})
