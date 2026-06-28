import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))

import { runEffect } from "~/lib/runtime.server"
import { loader } from "./admin.plugins"
import { callLoader, expectData } from "~/test/route-utils"

const mockRunEffect = vi.mocked(runEffect)

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/admin/plugins loader", () => {
  it("returns plugin manifests with installation counts", async () => {
    const data = [
      { slug: "gitea-teams", installations: 2 },
      { slug: "plex-libs", installations: 0 },
    ]
    mockRunEffect.mockResolvedValue(data as never)

    const result = await callLoader(loader)
    const loaded = expectData<{ plugins: unknown[] }>(result)
    expect(loaded.plugins).toEqual(data)
  })
})

// ===========================================================================
// Component-render tests
// ===========================================================================

import { screen, waitFor } from "@testing-library/react"
import AdminPluginsPage from "./admin.plugins"
import { renderRoute } from "~/test/render-route"

const mkRow = (slug: string, displayName: string, capabilities: string[] = ["lldap.group.read"]) => ({
  manifest: {
    slug,
    displayName,
    version: "1.0.0",
    description: "",
    capabilities,
    allowedDomains: [],
    vaultSecrets: [],
    configSchema: {},
    permissionStrategy: { byRoleSlug: {} },
    imperative: false,
    timeoutMs: 10_000,
  },
  installCount: 0,
})

const renderPage = (plugins: unknown[]) =>
  renderRoute({
    parentLoaderId: "routes/dashboard",
    parentLoader: () => ({ user: "admin", isAdmin: true }),
    route: {
      path: "/admin/plugins",
      Component: AdminPluginsPage as never,
      loader: () => ({ plugins }),
    },
  })

describe("AdminPluginsPage component", () => {
  it("renders one row per plugin", async () => {
    renderPage([
      mkRow("gitea-teams", "Gitea Teams", ["gitea.team.read", "gitea.team.member.add"]),
      mkRow("plex-libs", "Plex Libraries"),
    ])

    await waitFor(() => {
      expect(screen.getByText("Gitea Teams")).toBeInTheDocument()
    })
    expect(screen.getByText("Plex Libraries")).toBeInTheDocument()
    // Capability tags render too.
    expect(screen.getByText("gitea.team.read")).toBeInTheDocument()
  })

  it("flags declarative vs imperative plugins and shows version/timeout/installs", async () => {
    const declarative = mkRow("gitea-teams", "Gitea Teams")
    const imperative = {
      ...mkRow("plex-libs", "Plex Libraries"),
      manifest: {
        ...mkRow("plex-libs", "Plex Libraries").manifest,
        imperative: true,
        version: "2.3.0",
        timeoutMs: 30_000,
      },
      installCount: 4,
    }
    renderPage([declarative, imperative])

    await waitFor(() => {
      expect(screen.getByText("Declarative")).toBeInTheDocument()
    })
    expect(screen.getByText("Imperative")).toBeInTheDocument()
    // Imperative plugin's metadata renders in its row.
    expect(screen.getByText("2.3.0")).toBeInTheDocument()
    expect(screen.getByText("30s")).toBeInTheDocument()
    expect(screen.getByText("4")).toBeInTheDocument()
  })

  it("renders an empty table when there are no plugins", async () => {
    renderPage([])
    await waitFor(() => {
      expect(screen.getByText("Plugins (0)")).toBeInTheDocument()
    })
  })
})
