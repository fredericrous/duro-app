import { describe, it, expect, vi } from "vitest"
import { act, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { ApprovalGates } from "./ApprovalGates"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"
import type { ApprovalPolicy, Application, Entitlement, Principal, Role } from "~/lib/governance/types"

const application = {
  id: "app-1",
  slug: "nextcloud",
  displayName: "Nextcloud",
  description: null,
  accessMode: "request",
  ownerId: "p-daddy",
  enabled: true,
  url: null,
  homepage: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  lastSyncedAt: null,
} as Application

const principal = (id: string, displayName: string): Principal =>
  ({
    id,
    principalType: "user",
    externalId: id,
    displayName,
    email: null,
    enabled: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  }) as Principal

const principals = [principal("p-daddy", "daddy"), principal("p-marie", "Marie"), principal("p-leo", "Léo")]
const roles = [
  { id: "r-admin", applicationId: "app-1", slug: "admin", displayName: "Admin" } as Role,
  { id: "r-editor", applicationId: "app-1", slug: "editor", displayName: "Editor" } as Role,
]
const entitlements = [{ id: "e-access", applicationId: "app-1", slug: "access", displayName: "Access" } as Entitlement]

const policy = (overrides: Partial<ApprovalPolicy>): ApprovalPolicy => ({
  id: "pol",
  applicationId: "app-1",
  scopeType: "application",
  scopeId: null,
  mode: "one_of",
  rules: [{ approverType: "app_owner" }],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...overrides,
})

// ApprovalGates submits through useFetcher, so it needs a data router;
// renderRoute supplies one via createRoutesStub and captures the posted form.
const renderBoard = (policies: ApprovalPolicy[]) => {
  const posted: Array<Record<string, string>> = []
  const action = async ({ request }: { request: Request }) => {
    const fd = await request.formData()
    posted.push(Object.fromEntries([...fd.entries()].map(([k, v]) => [k, String(v)])))
    return { success: true, message: "gate_saved" }
  }
  renderRoute({
    route: {
      path: "/admin/applications/app-1",
      Component: (() => (
        <ApprovalGates
          application={application}
          roles={roles}
          entitlements={entitlements}
          principals={principals}
          policies={policies}
        />
      )) as never,
      loader: () => ({}),
      action,
    },
  })
  return posted
}

describe("ApprovalGates", () => {
  it("lists every scope with what guards it and warns when nothing does", async () => {
    renderBoard([])
    const list = await screen.findByRole("list", { name: t("admin.applications.gates.scopesLabel") })
    expect(within(list).getByText(t("admin.applications.gates.wholeApp"))).toBeInTheDocument()
    expect(within(list).getByText("Admin")).toBeInTheDocument()
    expect(within(list).getByText("Access")).toBeInTheDocument()
    // Four scopes, none guarded → four "no gate yet" badges.
    expect(within(list).getAllByText(t("admin.applications.gates.status.noGate"))).toHaveLength(4)
    // The editor opens on the whole app and says so.
    expect(screen.getByText(t("admin.applications.gates.editorTitleApp"))).toBeInTheDocument()
    expect(
      screen.getByText(
        t("admin.applications.gates.noGateWarning", undefined, { scope: t("admin.applications.gates.wholeApp") }),
      ),
    ).toBeInTheDocument()
  })

  it("shows inherited scopes as following the whole-app gate and own scopes with their gate count", async () => {
    renderBoard([
      policy({ id: "app-wide" }),
      policy({
        id: "admin-own",
        scopeType: "role",
        scopeId: "r-admin",
        mode: "all_of",
        rules: [{ approverType: "app_owner" }, { approverType: "principal", approverPrincipalId: "p-marie" }],
      }),
    ])
    const list = await screen.findByRole("list", { name: t("admin.applications.gates.scopesLabel") })
    expect(
      within(list).getByText(t("admin.applications.gates.status.gates", undefined, { count: 1 })),
    ).toBeInTheDocument()
    expect(
      within(list).getByText(t("admin.applications.gates.status.gates", undefined, { count: 2 })),
    ).toBeInTheDocument()
    // Editor + Access follow the whole app.
    expect(within(list).getAllByText(t("admin.applications.gates.status.inherits"))).toHaveLength(2)
  })

  it("slotting someone from the roster onto an open door flips the mode and narrates the outcome", async () => {
    renderBoard([])
    const slotMarie = await screen.findByRole("button", {
      name: t("admin.applications.gates.addToGates", undefined, { name: "Marie" }),
    })
    fireEvent.click(slotMarie)

    // Marie is now a gate that "can open" (any-one mode), and leaves the roster.
    expect(screen.getByText(t("admin.applications.gates.track.canOpen"))).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: t("admin.applications.gates.addToGates", undefined, { name: "Marie" }) }),
    ).toBeNull()
    expect(
      screen.getByText(
        t("admin.applications.gates.outcome.one_of", undefined, {
          scope: t("admin.applications.gates.wholeApp"),
          names: "Marie",
        }),
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(t("admin.applications.gates.unsaved"))).toBeInTheDocument()
  })

  it("saves the drafted gate for the selected scope with the rules as JSON", async () => {
    const posted = renderBoard([policy({ id: "app-wide" })])
    const list = await screen.findByRole("list", { name: t("admin.applications.gates.scopesLabel") })
    fireEvent.click(within(list).getByText("Admin"))
    await screen.findByText(t("admin.applications.gates.editorTitle", undefined, { scope: "Admin" }))

    fireEvent.click(
      screen.getByRole("button", { name: t("admin.applications.gates.addToGates", undefined, { name: "Marie" }) }),
    )
    fireEvent.click(screen.getByRole("button", { name: t("admin.applications.gates.mode.all_of") }))
    fireEvent.click(screen.getByRole("button", { name: t("admin.applications.gates.save") }))

    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({
      intent: "saveApprovalGate",
      scopeType: "role",
      scopeId: "r-admin",
      mode: "all_of",
    })
    expect(JSON.parse(posted[0].rules)).toEqual([
      { approverType: "app_owner" },
      { approverType: "principal", approverPrincipalId: "p-marie" },
    ])
  })

  it("offers to drop an own role gate back to the whole-app gate", async () => {
    const posted = renderBoard([
      policy({ id: "app-wide" }),
      policy({ id: "admin-own", scopeType: "role", scopeId: "r-admin", mode: "all_of" }),
    ])
    const list = await screen.findByRole("list", { name: t("admin.applications.gates.scopesLabel") })
    fireEvent.click(within(list).getByText("Admin"))
    const clear = await screen.findByRole("button", { name: t("admin.applications.gates.clear") })
    fireEvent.click(clear)
    await waitFor(() => expect(posted).toHaveLength(1))
    expect(posted[0]).toMatchObject({ intent: "clearApprovalGate", scopeType: "role", scopeId: "r-admin" })
  })

  it("keeps the whole-app scope free of the clear action", async () => {
    renderBoard([policy({ id: "app-wide" })])
    await screen.findByText(t("admin.applications.gates.editorTitleApp"))
    expect(screen.queryByRole("button", { name: t("admin.applications.gates.clear") })).toBeNull()
    vi.restoreAllMocks()
  })
})

// Drag is the fast path on top of the buttons. The DS proves the gesture in
// real Chromium; this file owns the wiring — a drop on the track puts the
// person into the draft at the dropped index. jsdom has no layout, so every
// rect is 0×0 and a release at the origin resolves to the first registered
// zone, which is the track.
describe("ApprovalGates drag and drop", () => {
  const pointer = (type: string, target: EventTarget, x: number, y: number) =>
    target.dispatchEvent(
      new (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        pointerId: 1,
        pointerType: "mouse",
      } as PointerEventInit),
    )

  it("dropping a roster person on the track slots them at the dropped index", async () => {
    renderBoard([policy({ id: "app-wide" })])
    const marie = await screen.findByRole("button", {
      name: t("admin.applications.gates.addToGates", undefined, { name: "Marie" }),
    })
    const item = marie.parentElement as HTMLElement
    // The board's pointer listeners attach in passive effects, which React may
    // still be holding when findByRole resolves on a cold run. Flush them.
    await act(async () => {})

    pointer("pointerdown", item, 0, 0)
    pointer("pointermove", document, 40, 40) // past the threshold: the drag starts
    pointer("pointerup", document, 0, 0) // released over the (zero-rect) track

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: t("admin.applications.gates.addToGates", undefined, { name: "Marie" }) }),
      ).toBeNull()
    })
    // Marie is now a gate, ahead of the owner since she landed at index 0:
    // the outcome sentence lists gates in track order.
    const names = new Intl.ListFormat("en", { style: "long", type: "disjunction" }).format([
      "Marie",
      `${t("admin.applications.gates.owner")} · daddy`,
    ])
    expect(
      screen.getByText(
        t("admin.applications.gates.outcome.one_of", undefined, {
          scope: t("admin.applications.gates.wholeApp"),
          names,
        }),
      ),
    ).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Dropped Marie")
    expect(screen.getByText(t("admin.applications.gates.unsaved"))).toBeInTheDocument()
  })
})
