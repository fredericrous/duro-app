import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("~/lib/runtime.server", async () => {
  const mod = await import("~/test/test-runtime")
  return { runEffect: mod.testRunEffect }
})
vi.mock("~/lib/config.server", () => ({
  config: { appName: "Duro" },
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
vi.mock("~/lib/crypto.server", () => ({
  hashToken: vi.fn().mockReturnValue("hashed-token"),
}))

import { action, loader } from "./reinvite"
import { truncateAll } from "~/test/test-runtime"
import { callAction, callLoader, expectData } from "~/test/route-utils"

beforeEach(async () => {
  vi.clearAllMocks()
  await truncateAll()
})

describe("/reinvite/:token loader", () => {
  it("returns canReinvite=false / missing_token when params.token is absent", async () => {
    const result = await callLoader(loader, { params: {} })
    const data = expectData<{ canReinvite: boolean; error?: string }>(result)
    expect(data.canReinvite).toBe(false)
    expect(data.error).toBe("missing_token")
  })

  it("returns invalid error when the token doesn't match any invite", async () => {
    const result = await callLoader(loader, { params: { token: "no-such-token" } })
    const data = expectData<{ canReinvite: boolean; error?: string }>(result)
    expect(data.canReinvite).toBe(false)
    expect(data.error).toBeDefined()
  })
})

describe("/reinvite/:token action", () => {
  it("returns missing_token error when params.token is absent", async () => {
    const result = await callAction(action, { params: {} })
    const data = expectData<{ success: boolean; error?: string }>(result)
    expect(data.success).toBe(false)
    expect(data.error).toBe("missing_token")
  })

  it("returns an error shape when the token doesn't match any invite", async () => {
    const result = await callAction(action, { params: { token: "no-such-token" } })
    const data = expectData<{ success: boolean; error?: string }>(result)
    expect(data.success).toBe(false)
  })
})

// =============================================================================
// Component-render tests
// =============================================================================

import { screen, waitFor } from "@testing-library/react"
import ReinvitePage from "./reinvite"
import { renderRoute } from "~/test/render-route"

const renderReinvite = (loaderData: unknown, opts: { actionData?: unknown; url?: string } = {}) => {
  // We pre-bind actionData in a wrapper since renderRoute doesn't accept it
  // directly (createRoutesStub provides actionData via fetcher submission).
  // Cast through `never` so TS doesn't enforce the Route.ComponentProps
  // signature on the wrapper.
  const ReinviteAny = ReinvitePage as unknown as (props: {
    loaderData: unknown
    actionData: unknown
  }) => React.ReactElement
  const PageWithActionData = (props: { loaderData: unknown }) => (
    <ReinviteAny loaderData={props.loaderData} actionData={opts.actionData} />
  )
  return renderRoute({
    route: {
      path: "/reinvite/:token",
      Component: PageWithActionData as never,
      loader: () => loaderData,
    },
    url: opts.url ?? "/reinvite/abc",
  })
}

describe("ReinvitePage component", () => {
  it("renders the still-valid error card when canReinvite is false / still_valid", async () => {
    renderReinvite({ canReinvite: false, error: "still_valid", appName: "Duro" })
    await waitFor(() => {
      expect(screen.getByRole("heading")).toBeInTheDocument()
    })
  })

  it("renders the error card when canReinvite is false / invalid", async () => {
    renderReinvite({ canReinvite: false, error: "invalid", appName: "Duro" })
    await waitFor(() => {
      expect(screen.getByRole("heading")).toBeInTheDocument()
    })
  })

  it("renders the submit form when canReinvite is true", async () => {
    renderReinvite({ canReinvite: true, email: "alice@example.com", appName: "Duro" })
    await waitFor(() => {
      expect(screen.getByRole("button")).toBeInTheDocument()
    })
    // The email appears inside the body copy (possibly inside multiple
    // wrapping text nodes — just assert at least one match).
    const matches = screen.getAllByText((_, node) => Boolean(node?.textContent?.includes("alice@example.com")))
    expect(matches.length).toBeGreaterThan(0)
  })

  it("renders the success view when actionData.success is true", async () => {
    renderReinvite(
      { canReinvite: true, email: "alice@example.com", appName: "Duro" },
      { actionData: { success: true, email: "alice@example.com" } },
    )
    await waitFor(() => {
      // Success heading title.
      expect(screen.getByRole("heading")).toBeInTheDocument()
    })
    // No submit button on the success branch.
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})
