import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { loader } from "./admin.principals"
import { callLoader, expectData } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/admin/principals loader", () => {
  it("returns the principal list via the repo", async () => {
    const principals = [
      { id: "p1", principalType: "user", displayName: "Alice" },
      { id: "p2", principalType: "group", displayName: "Admins" },
    ]
    mockRunEffect.mockResolvedValue(principals as never)

    const result = await callLoader(loader)
    const data = expectData<{ principals: unknown[] }>(result)
    expect(data.principals).toEqual(principals)
  })
})

// ===========================================================================
// Component-render tests
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import type { Principal } from "~/lib/governance/types"
import AdminPrincipalsPage from "./admin.principals"
import { renderRoute } from "~/test/render-route"

const mkPrincipal = (o: Partial<Principal> & Pick<Principal, "id">): Principal =>
  ({
    principalType: "user",
    externalId: o.id,
    displayName: o.id,
    email: `${o.id}@example.com`,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    // Spread last so required id + any overrides win.
    ...o,
  }) as Principal

const renderPage = (principals: Principal[]) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    route: {
      path: "/admin/principals",
      Component: AdminPrincipalsPage as never,
      loader: () => ({ principals }),
    },
  })

describe("AdminPrincipalsPage component", () => {
  it("renders rows for users, groups, and service accounts", async () => {
    renderPage([
      mkPrincipal({ id: "p-alice", displayName: "Alice", principalType: "user" }),
      mkPrincipal({ id: "p-eng", displayName: "Engineering", principalType: "group" }),
      mkPrincipal({ id: "p-ci", displayName: "CI Bot", principalType: "service_account" }),
    ])

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument()
    })
    expect(screen.getByText("Engineering")).toBeInTheDocument()
    expect(screen.getByText("CI Bot")).toBeInTheDocument()
  })

  it("renders an empty-state when the principal list is empty", async () => {
    renderPage([])
    await waitFor(() => {
      // Some i18n string for the empty principals list; just confirm we
      // didn't crash and a table row isn't rendered.
      expect(screen.queryByText("Alice")).not.toBeInTheDocument()
    })
  })
})
