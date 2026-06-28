import { describe, it, expect } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { Header } from "./Header"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

// Header uses <Link>, useNavigate and the DS <Menu>, all of which need a
// data-router context — supply one via renderRoute/createRoutesStub.
const renderHeader = (props: { user: string; isAdmin: boolean; showMenu?: boolean }) =>
  renderRoute({
    route: {
      path: "/",
      Component: (() => <Header {...props} />) as never,
      loader: () => ({}),
    },
  })

describe("Header", () => {
  it("renders the app title logo", async () => {
    renderHeader({ user: "alice", isAdmin: false })
    await waitFor(() => {
      expect(screen.getByText(t("common.appTitle"))).toBeInTheDocument()
    })
  })

  it("hides the menu trigger when showMenu is false", async () => {
    renderHeader({ user: "alice", isAdmin: false, showMenu: false })
    await waitFor(() => {
      expect(screen.getByText(t("common.appTitle"))).toBeInTheDocument()
    })
    expect(screen.queryByText(t("header.welcome", undefined, { user: "alice" }))).not.toBeInTheDocument()
  })

  it("renders the menu trigger with the welcome greeting for the user", async () => {
    renderHeader({ user: "alice", isAdmin: true })
    // The Menu.Trigger surfaces the greeting; opening the popup is an
    // interaction the DS Menu doesn't settle reliably under jsdom (floating
    // portal), so we assert the trigger renders rather than driving it open.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Welcome, alice/ })).toBeInTheDocument()
    })
  })
})
