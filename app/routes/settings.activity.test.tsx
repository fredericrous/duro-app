import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/auth.server", () => ({
  requireAuth: vi.fn(),
}))
vi.mock("~/lib/runtime.server", () => ({
  runEffect: vi.fn(),
}))
// Importing the server modules pulls the whole server graph — the loader only
// passes their Effects to the mocked runEffect, so stub them out.
vi.mock("~/lib/governance/PrincipalRepo.server", () => ({ PrincipalRepo: {} }))
vi.mock("~/lib/settings/user-activity.server", () => ({
  loadUserActivity: vi.fn(),
  loadUserAccess: vi.fn(),
}))

import { requireAuth } from "~/lib/auth.server"
import { runEffect } from "~/lib/runtime.server"
import { loader } from "./settings.activity"
import { callLoader, expectData } from "~/test/route-utils"

const mockRequireAuth = vi.mocked(requireAuth)
const mockRunEffect = vi.mocked(runEffect)

const AUTH = { sub: "me", user: "Me", email: "me@x.test", groups: ["family"] }

type ActivityData = {
  events: Array<{ id: string; eventType: string; byMe: boolean }>
  access: Array<{ id: string; what: string | null }>
  groups: string[]
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("/settings/activity loader", () => {
  it("returns events, access and groups for a synced principal", async () => {
    mockRequireAuth.mockResolvedValue(AUTH as never)
    mockRunEffect.mockResolvedValueOnce({
      principalId: "p-me",
      events: [
        {
          id: "e1",
          eventType: "auth.login",
          actorId: "p-me",
          actorName: "Me",
          targetName: null,
          applicationName: null,
          createdAt: "2026-07-26T09:00:00.000Z",
        },
        {
          id: "e2",
          eventType: "grant.created",
          actorId: "p-admin",
          actorName: "Admin",
          targetName: "Viewer → Me",
          applicationName: null,
          createdAt: "2026-07-25T09:00:00.000Z",
        },
      ],
      access: [{ id: "g1", what: "Viewer", app: "App One", reason: null, grantedAt: "2026-07-01", expiresAt: null }],
      groups: ["media"],
    } as never)

    const result = await callLoader(loader)
    const data = expectData<ActivityData>(result)
    expect(data.events).toHaveLength(2)
    expect(data.events[0].byMe).toBe(true)
    expect(data.events[1].byMe).toBe(false)
    expect(data.access).toHaveLength(1)
    // Governance groups win over session groups when present.
    expect(data.groups).toEqual(["media"])
  })

  it("falls back to session groups and empties when the principal is not synced yet", async () => {
    mockRequireAuth.mockResolvedValue(AUTH as never)
    mockRunEffect.mockResolvedValueOnce({ events: [], access: [], groups: [] } as never)

    const result = await callLoader(loader)
    const data = expectData<ActivityData>(result)
    expect(data.events).toEqual([])
    expect(data.access).toEqual([])
    expect(data.groups).toEqual(["family"])
  })

  it("degrades to empty sections when the query fails", async () => {
    mockRequireAuth.mockResolvedValue(AUTH as never)
    // Query failures are caught inside the effect (catchAll → empty shape);
    // the mocked resolution is that in-effect fallback outcome.
    mockRunEffect.mockResolvedValueOnce({ principalId: undefined, events: [], access: [], groups: [] } as never)

    const result = await callLoader(loader)
    const data = expectData<ActivityData>(result)
    expect(data.events).toEqual([])
    expect(data.access).toEqual([])
    expect(data.groups).toEqual(["family"])
  })
})

// =============================================================================
// Component-render tests
// =============================================================================

import { screen } from "@testing-library/react"
import ActivitySettings from "./settings.activity"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

const renderActivity = (loaderData: unknown) =>
  renderRoute({
    route: {
      path: "/settings/activity",
      Component: ActivitySettings as never,
      loader: () => loaderData,
    },
  })

describe("ActivitySettings component", () => {
  it("renders activity rows, access with reason, and group tags", async () => {
    renderActivity({
      events: [
        {
          id: "e1",
          eventType: "auth.login",
          actorName: "Me",
          targetName: null,
          applicationName: null,
          createdAt: "2026-07-26T09:00:00.000Z",
          byMe: true,
        },
        {
          id: "e2",
          eventType: "user.revoked",
          actorName: "Admin",
          targetName: "Me",
          applicationName: null,
          createdAt: "2026-07-25T09:00:00.000Z",
          byMe: false,
        },
      ],
      access: [
        {
          id: "g1",
          what: "Viewer",
          app: "App One",
          reason: "onboarding",
          grantedAt: "2026-07-01T00:00:00.000Z",
          expiresAt: "2026-08-26T00:00:00.000Z",
        },
      ],
      groups: ["family", "media"],
    })

    await screen.findByText(t("settings.activity.recentTitle"))
    // "was this you?" hint present.
    expect(screen.getByText(t("settings.activity.recentHint"))).toBeInTheDocument()
    // An action done TO me shows the actor's name.
    expect(screen.getByText("Admin")).toBeInTheDocument()
    // Access row: what · app + reason + expiry.
    expect(screen.getByText("Viewer · App One")).toBeInTheDocument()
    expect(
      screen.getByText(t("settings.activity.accessReason", undefined, { reason: "onboarding" })),
    ).toBeInTheDocument()
    // Groups as tags.
    expect(screen.getByText("family")).toBeInTheDocument()
    expect(screen.getByText("media")).toBeInTheDocument()
  })

  it("renders quiet empty states", async () => {
    renderActivity({ events: [], access: [], groups: [] })

    await screen.findByText(t("settings.activity.recentTitle"))
    expect(screen.getByText(t("settings.activity.recentEmpty"))).toBeInTheDocument()
    expect(screen.getByText(t("settings.activity.accessEmpty"))).toBeInTheDocument()
    expect(screen.getByText(t("settings.activity.groupsEmpty"))).toBeInTheDocument()
  })
})
