import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", () => ({ runEffect: vi.fn() }))
vi.mock("~/lib/config.server", () => ({
  config: { isSystemUser: (id: string) => id === "system" },
  isOriginAllowed: vi.fn(() => true),
}))
vi.mock("~/lib/admin-guard.server", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ sub: "admin", user: "admin", email: "a@b", groups: ["lldap_admin"] }),
  requireAdminAction: vi.fn().mockResolvedValue({ sub: "admin", user: "admin", email: "a@b", groups: ["lldap_admin"] }),
}))

import { runEffect } from "~/lib/runtime.server"
import { requireAdmin, requireAdminAction } from "~/lib/admin-guard.server"
import { loader, action } from "./admin.identities"

const mockRunEffect = vi.mocked(runEffect)

const req = () => new Request("http://x/admin/identities")

beforeEach(() => vi.clearAllMocks())

// --- loader ---

describe("/admin/identities loader", () => {
  it("returns users, principals, revocations, certs, and system ids", async () => {
    mockRunEffect
      .mockResolvedValueOnce([
        { id: "alice", displayName: "Alice", email: "a@x.com", creationDate: "2024-01-01" },
        { id: "system", displayName: "system", email: "s@x.com", creationDate: "2024-01-01" },
      ] as never)
      .mockResolvedValueOnce([{ id: "g1", principalType: "group", displayName: "Eng", enabled: true }] as never)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce({} as never)

    const data = (await loader({ request: req() } as never)) as {
      users: unknown[]
      principals: unknown[]
      systemUserIds: string[]
    }
    expect(data.users).toHaveLength(2)
    expect(data.principals).toHaveLength(1)
    expect(data.systemUserIds).toEqual(["system"])
  })

  it("denies a non-admin (403)", async () => {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Response("Forbidden", { status: 403 }))
    await expect(loader({ request: req() } as never)).rejects.toMatchObject({ status: 403 })
  })
})

// --- action (mutation entry point) ---

describe("/admin/identities action", () => {
  const post = (body: Record<string, string>) => {
    const fd = new FormData()
    for (const [k, v] of Object.entries(body)) fd.set(k, v)
    return action({ request: new Request("http://x/admin/identities", { method: "POST", body: fd }) } as never)
  }

  it("surfaces the guard's 403 when requireAdminAction rejects (bad origin / non-admin)", async () => {
    vi.mocked(requireAdminAction).mockRejectedValueOnce(new Response("Forbidden", { status: 403 }))
    await expect(post({ intent: "revokeUser" })).rejects.toMatchObject({ status: 403 })
  })

  it("dispatches a valid mutation through the handler", async () => {
    mockRunEffect.mockResolvedValueOnce({ success: true, message: "done" } as never)
    const res = await post({ intent: "revokeUser", username: "alice", email: "a@x.com", reason: "left" })
    expect(res).toMatchObject({ success: true })
    expect(mockRunEffect).toHaveBeenCalled()
  })
})

// --- component render ---

import { screen, waitFor } from "@testing-library/react"
import { ActionBarProvider } from "@duro-app/ui"
import AdminIdentitiesPage from "./admin.identities"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

// The page mounts DS ActionBars, which only render their children (and thus
// evaluate their inline label/handler callbacks) inside an ActionBarProvider —
// in prod it lives in root.tsx. Wrapping here exercises those render-time
// functions without any (deadlock-prone) row-selection interaction.
const AdminIdentitiesAny = AdminIdentitiesPage as unknown as (props: { loaderData: unknown }) => React.ReactElement
const PageWithProviders = (props: { loaderData: unknown }) => (
  <ActionBarProvider>
    <AdminIdentitiesAny loaderData={props.loaderData} />
  </ActionBarProvider>
)

const sidePanelCtx = {
  open: false,
  onOpenChange: vi.fn(),
  content: null,
  setContent: vi.fn(),
  onCloseRef: { current: null },
  showDetail: vi.fn(),
  isWide: true,
}

const fixture = {
  users: [
    { id: "alice", displayName: "Alice Admin", email: "alice@corp.com", creationDate: "2024-01-01" },
    { id: "bob", displayName: "Bob Newbie", email: "bob@corp.com", creationDate: "2024-01-01" },
  ],
  principals: [
    {
      id: "p-alice",
      principalType: "user",
      externalId: "alice",
      displayName: "Alice",
      email: null,
      enabled: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
    {
      id: "g-eng",
      principalType: "group",
      externalId: null,
      displayName: "Engineers",
      email: null,
      enabled: true,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    },
  ],
  revocations: [],
  systemUserIds: [],
  certsByUser: {},
}

const renderIdentities = (loaderData: typeof fixture = fixture) =>
  renderRoute({
    route: { path: "/admin/identities", Component: PageWithProviders as never, loader: () => loaderData },
    parentContext: sidePanelCtx,
  })

describe("AdminIdentitiesPage", () => {
  it("renders a unified, type-faceted identity list from users + principals", async () => {
    renderIdentities()
    await waitFor(() => {
      expect(screen.getByText("Alice Admin")).toBeInTheDocument()
    })
    // The group principal appears alongside human users in one list.
    expect(screen.getByText("Engineers")).toBeInTheDocument()
    // Type badges use the humanized enum labels.
    expect(screen.getAllByText(t("common.enums.principalType.user", "User")).length).toBeGreaterThan(0)
    expect(screen.getByText(t("common.enums.principalType.group", "Group"))).toBeInTheDocument()
  })

  it("flags an IdP user with no governance principal as not provisioned", async () => {
    renderIdentities()
    // Bob has no matching principal in the fixture → un-provisioned badge.
    await waitFor(() => {
      expect(screen.getByText(t("admin.identities.notProvisioned", "Not provisioned"))).toBeInTheDocument()
    })
  })

  it("offers a governance detail link for non-user identities", async () => {
    renderIdentities()
    await waitFor(() => {
      const view = screen.getByText(t("admin.identities.view", "View"))
      expect(view.closest("a")).toHaveAttribute("href", "/admin/principals/g-eng")
    })
  })

  it("links to Group Mappings from the identities header", async () => {
    renderIdentities()
    await waitFor(() => {
      const link = screen.getByText(t("admin.nav.groupMappings", "Group Mappings"))
      expect(link.closest("a")).toHaveAttribute("href", "/admin/group-mappings")
    })
  })

  it("renders cert status, disabled state, a selectable checkbox, and the revoked section", async () => {
    const expires = "2999-01-01T00:00:00Z"
    renderIdentities({
      users: [
        { id: "alice", displayName: "Alice Admin", email: "alice@corp.com", creationDate: "2024-01-01" },
        { id: "dan", displayName: "Dan Disabled", email: "dan@corp.com", creationDate: "2024-01-01" },
      ],
      principals: [
        // Alice: provisioned + a live cert → active-cert status + selectable row.
        {
          id: "p-alice",
          principalType: "user",
          externalId: "alice",
          displayName: "Alice",
          email: null,
          enabled: true,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
        // Dan: provisioned but disabled → the disabled badge branch.
        {
          id: "p-dan",
          principalType: "user",
          externalId: "dan",
          displayName: "Dan",
          email: null,
          enabled: false,
          createdAt: "2024-01-01T00:00:00Z",
          updatedAt: "2024-01-01T00:00:00Z",
        },
      ],
      revocations: [
        {
          id: "r1",
          email: "gone@corp.com",
          username: "gone",
          reason: "left",
          revokedAt: "2024-06-01T00:00:00Z",
          revokedBy: "admin",
        },
      ] as never,
      systemUserIds: [],
      certsByUser: {
        alice: [
          {
            id: "c1",
            inviteId: null,
            userId: null,
            username: "alice",
            email: "alice@corp.com",
            label: "laptop",
            serialNumber: "AA:BB:CC",
            issuedAt: "2024-01-01T00:00:00Z",
            expiresAt: expires,
            revokedAt: null,
            revokeState: null,
            revokeError: null,
          },
        ],
      },
    })
    // Active-cert status badge for alice ("{{count}} active" → "1 active").
    await waitFor(() => expect(screen.getByText("1 active")).toBeInTheDocument())
    // Disabled badge for dan.
    expect(screen.getByText(t("admin.identities.disabled", "Disabled"))).toBeInTheDocument()
    // Alice's row is selection-eligible → a checkbox carrying her uid.
    expect(screen.getByLabelText("alice")).toBeInTheDocument()
    // Revoked-users section renders.
    expect(screen.getByText(`${t("admin.users.revokedTitle")} (1)`)).toBeInTheDocument()
  })

  it("renders the empty state when there are no identities or revocations", async () => {
    renderIdentities({ users: [], principals: [], revocations: [], systemUserIds: [], certsByUser: {} })
    await waitFor(() => expect(screen.getByText(t("admin.identities.empty", "No identities yet."))).toBeInTheDocument())
  })
})
