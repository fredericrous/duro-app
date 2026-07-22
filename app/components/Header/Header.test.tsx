import { describe, it, expect } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { Header } from "./Header"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

// Header uses <Link>, useNavigate and the DS <Menu>, all of which need a
// data-router context — supply one via renderRoute/createRoutesStub. The
// "My requests" badge reads openRequestItems from the "routes/dashboard"
// layout loader, so pass one when a test needs the badge to render.
const renderHeader = (props: { user: string; isAdmin: boolean; showMenu?: boolean }, openRequestItems?: number) =>
  renderRoute({
    parentLoaderId: openRequestItems === undefined ? undefined : "routes/dashboard",
    parentLoader: openRequestItems === undefined ? undefined : () => ({ openRequestItems }),
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

  it("surfaces the primary verbs as persistent links to the catalog and requests", async () => {
    renderHeader({ user: "alice", isAdmin: false })
    await waitFor(() => {
      expect(screen.getByRole("link", { name: t("header.requestAccess") })).toBeInTheDocument()
    })
    // "Request access" takes the user to the catalog to browse and request.
    expect(screen.getByRole("link", { name: t("header.requestAccess") })).toHaveAttribute("href", "/catalog")
    // "My requests" is a visible link, not a dropdown row.
    expect(screen.getByRole("link", { name: new RegExp(t("header.myRequests")) })).toHaveAttribute("href", "/requests")
  })

  it("hides the actions and menu trigger when showMenu is false", async () => {
    renderHeader({ user: "alice", isAdmin: false, showMenu: false })
    await waitFor(() => {
      expect(screen.getByText(t("common.appTitle"))).toBeInTheDocument()
    })
    expect(screen.queryByText(t("header.welcome", undefined, { user: "alice" }))).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: t("header.requestAccess") })).not.toBeInTheDocument()
  })

  it("renders the account menu trigger with the welcome greeting for the user", async () => {
    renderHeader({ user: "alice", isAdmin: true })
    // The Menu.Trigger surfaces the greeting; opening the popup is an
    // interaction the DS Menu doesn't settle reliably under jsdom (floating
    // portal), so we assert the trigger renders rather than driving it open.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Welcome, alice/ })).toBeInTheDocument()
    })
  })

  it("badges My requests with the count of open items", async () => {
    renderHeader({ user: "alice", isAdmin: false }, 3)
    await waitFor(() => {
      expect(screen.getByRole("link", { name: new RegExp(t("header.myRequests")) })).toBeInTheDocument()
    })
    // The badge count rides inside the link's accessible name.
    expect(screen.getByRole("link", { name: /My requests.*3/ })).toBeInTheDocument()
  })

  it("omits the badge when nothing is awaiting the user", async () => {
    renderHeader({ user: "alice", isAdmin: false }, 0)
    await waitFor(() => {
      expect(screen.getByRole("link", { name: new RegExp(t("header.myRequests")) })).toBeInTheDocument()
    })
    expect(screen.queryByText("0")).not.toBeInTheDocument()
  })
})
