import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"

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
import { seedTestDb, truncateAll } from "~/test/test-runtime"
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

  it("returns 'already_used' when the invite is already consumed by a real user", async () => {
    // Seed an invite with usedBy = some real user (not the __revoked__ marker).
    await seedTestDb(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO invites (id, token, token_hash, email, groups, group_names, invited_by, locale, expires_at, used_at, used_by)
                   VALUES ('inv-used', 'consumed-token', 'hashed-token', 'used@x.com',
                           '[1]', '["family"]', 'admin', 'en',
                           ${new Date(Date.now() + 86400_000).toISOString()},
                           ${new Date().toISOString()}, 'real-user')`
      }) as Effect.Effect<void, never, never>,
    )

    const result = await callAction(action, { params: { token: "consumed-token" } })
    const data = expectData<{ success: boolean; error?: string }>(result)
    expect(data.success).toBe(false)
    expect(data.error).toBe("already_used")
  })
})

describe("/reinvite/:token loader — additional branches", () => {
  beforeEach(async () => {
    await truncateAll()
  })

  it("returns 'invalid' when no invite matches the hashed token", async () => {
    // Empty DB → InviteRepo.findByTokenHash returns null.
    const result = await callLoader(loader, { params: { token: "no-match" } })
    const data = expectData<{ canReinvite: boolean; error?: string }>(result)
    expect(data.canReinvite).toBe(false)
    expect(data.error).toBe("invalid")
  })

  it("returns canReinvite=true when the invite is expired (eligible for re-send)", async () => {
    // expiresAt in the past → isExpired=true → still_valid branch skipped.
    await seedTestDb(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO invites (id, token, token_hash, email, groups, group_names, invited_by, locale, expires_at)
                   VALUES ('inv-expired', 'expired-tok', 'hashed-token', 'old@x.com',
                           '[1]', '["family"]', 'admin', 'en',
                           ${new Date(Date.now() - 86400_000).toISOString()})`
      }) as Effect.Effect<void, never, never>,
    )

    const result = await callLoader(loader, { params: { token: "expired-tok" } })
    const data = expectData<{ canReinvite: boolean; email?: string }>(result)
    expect(data.canReinvite).toBe(true)
    expect(data.email).toBe("old@x.com")
  })
})

// =============================================================================
// Component-render tests
// =============================================================================

import { screen, waitFor } from "@testing-library/react"
import ReinvitePage from "./reinvite"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

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
    // Error card heading uses t("reinvite.error.title") regardless of error code.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: t("reinvite.error.title") })).toBeInTheDocument()
    })
  })

  it("renders the error card when canReinvite is false / invalid", async () => {
    renderReinvite({ canReinvite: false, error: "invalid", appName: "Duro" })
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: t("reinvite.error.title") })).toBeInTheDocument()
    })
  })

  it("renders the submit form when canReinvite is true", async () => {
    renderReinvite({ canReinvite: true, email: "alice@example.com", appName: "Duro" })
    // The canReinvite branch uses t("reinvite.heading") as the page title.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: t("reinvite.heading") })).toBeInTheDocument()
    })
    // The email is interpolated into the <p> body via t("reinvite.message").
    expect(
      screen.getByText((_, node) => node?.tagName === "P" && Boolean(node.textContent?.includes("alice@example.com"))),
    ).toBeInTheDocument()
  })

  it("renders the success view when actionData.success is true", async () => {
    renderReinvite(
      { canReinvite: true, email: "alice@example.com", appName: "Duro" },
      { actionData: { success: true, email: "alice@example.com" } },
    )
    // Success branch uses t("reinvite.success.title") + no submit button.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: t("reinvite.success.title") })).toBeInTheDocument()
    })
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})
