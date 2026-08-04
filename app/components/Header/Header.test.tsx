import { describe, it, expect } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import { Header } from "./Header"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

// Header uses <Link>, useNavigate and the DS <Menu>, all of which need a
// data-router context — supply one via renderRoute/createRoutesStub. The
// "My requests" badge reads openRequestItems from the "routes/dashboard"
// layout loader, so pass one when a test needs the badge to render.
const renderHeader = (
  props: { user: string; isAdmin: boolean; showMenu?: boolean },
  dashboard?: { openRequestItems?: number; certAlerts?: number },
) =>
  renderRoute({
    parentLoaderId: dashboard === undefined ? undefined : "routes/dashboard",
    parentLoader: dashboard === undefined ? undefined : () => dashboard,
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

  it("surfaces the account-upkeep surfaces as persistent links", async () => {
    renderHeader({ user: "alice", isAdmin: false })
    await waitFor(() => {
      expect(screen.getByRole("link", { name: new RegExp(t("header.devices")) })).toBeInTheDocument()
    })
    expect(screen.getByRole("link", { name: new RegExp(t("header.devices")) })).toHaveAttribute("href", "/devices")
    // "My requests" is a visible link, not a dropdown row.
    expect(screen.getByRole("link", { name: new RegExp(t("header.myRequests")) })).toHaveAttribute("href", "/requests")
  })

  it("no longer carries a Request access button — that CTA lives where it is the next step", async () => {
    renderHeader({ user: "alice", isAdmin: false })
    await waitFor(() => {
      expect(screen.getByText(t("common.appTitle"))).toBeInTheDocument()
    })
    expect(screen.queryByRole("link", { name: t("header.requestAccess") })).not.toBeInTheDocument()
  })

  it("hides the actions and menu trigger when showMenu is false", async () => {
    renderHeader({ user: "alice", isAdmin: false, showMenu: false })
    await waitFor(() => {
      expect(screen.getByText(t("common.appTitle"))).toBeInTheDocument()
    })
    expect(screen.queryByText(t("header.welcome", undefined, { user: "alice" }))).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: new RegExp(t("header.devices")) })).not.toBeInTheDocument()
    expect(screen.queryByRole("link", { name: new RegExp(t("header.myRequests")) })).not.toBeInTheDocument()
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
    renderHeader({ user: "alice", isAdmin: false }, { openRequestItems: 3 })
    await waitFor(() => {
      expect(screen.getByRole("link", { name: new RegExp(t("header.myRequests")) })).toBeInTheDocument()
    })
    // The badge count rides inside the link's accessible name.
    expect(screen.getByRole("link", { name: /My requests.*3/ })).toBeInTheDocument()
  })

  it("omits the badge when nothing is awaiting the user", async () => {
    renderHeader({ user: "alice", isAdmin: false }, { openRequestItems: 0 })
    await waitFor(() => {
      expect(screen.getByRole("link", { name: new RegExp(t("header.myRequests")) })).toBeInTheDocument()
    })
    expect(screen.queryByText("0")).not.toBeInTheDocument()
  })

  it("badges Devices when a certificate needs attention", async () => {
    renderHeader({ user: "alice", isAdmin: false }, { certAlerts: 2 })
    await waitFor(() => {
      expect(screen.getByRole("link", { name: new RegExp(t("header.devices")) })).toBeInTheDocument()
    })
    // An expiring cert only announces itself as a lockout, so the count rides
    // in the link's accessible name.
    expect(screen.getByRole("link", { name: /Devices.*2/ })).toBeInTheDocument()
  })

  it("omits the Devices badge when every certificate is healthy", async () => {
    renderHeader({ user: "alice", isAdmin: false }, { certAlerts: 0 })
    await waitFor(() => {
      expect(screen.getByRole("link", { name: new RegExp(t("header.devices")) })).toBeInTheDocument()
    })
    expect(screen.queryByText("0")).not.toBeInTheDocument()
  })
})
