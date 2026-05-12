import { describe, expect, it, vi, beforeEach } from "vitest"
import { Effect } from "effect"
import * as SqlClient from "@effect/sql/SqlClient"

vi.mock("~/lib/runtime.server", async () => {
  const mod = await import("~/test/test-runtime")
  return { runEffect: mod.testRunEffect }
})
vi.mock("~/lib/config.server", () => ({
  config: { appName: "Duro", homeUrl: "https://duro.example.com" },
  isOriginAllowed: vi.fn().mockReturnValue(true),
}))
vi.mock("~/lib/crypto.server", () => ({
  hashToken: vi.fn((s: string) => `hashed-${s}`),
}))

import { action, loader } from "./invite-create-account"
import { seedTestDb, truncateAll } from "~/test/test-runtime"
import { callAction, callLoader, expectData } from "~/test/route-utils"

beforeEach(async () => {
  vi.clearAllMocks()
  await truncateAll()
})

describe("/invite/:token/create-account loader", () => {
  it("returns missing_token when params.token is absent", async () => {
    const result = await callLoader(loader, { params: {} })
    const data = expectData<{ valid: boolean; error?: string }>(result)
    expect(data.valid).toBe(false)
    expect(data.error).toBe("missing_token")
  })

  it("returns 'invalid' when no matching invite exists", async () => {
    const result = await callLoader(loader, { params: { token: "no-match" } })
    const data = expectData<{ valid: boolean; error?: string }>(result)
    expect(data.valid).toBe(false)
    expect(data.error).toBeDefined()
  })

  it("returns valid=true with invite data for a fresh unused invite", async () => {
    // Seed an invite with the same hash hashToken("token-1") produces.
    // The mock returns "hashed-token-1".
    await seedTestDb(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO invites (id, token, token_hash, email, groups, group_names, invited_by, locale, expires_at)
                   VALUES ('inv-1', 'token-1', 'hashed-token-1', 'alice@example.com',
                           '[1]', '["family"]', 'admin', 'en',
                           ${new Date(Date.now() + 86400_000).toISOString()})`
      }) as Effect.Effect<void, never, never>,
    )

    const result = await callLoader(loader, { params: { token: "token-1" } })
    const data = expectData<{ valid: boolean; email?: string }>(result)
    expect(data.valid).toBe(true)
    expect(data.email).toBe("alice@example.com")
  })

  it("returns 'already_used' when the invite has been consumed", async () => {
    await seedTestDb(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO invites (id, token, token_hash, email, groups, group_names, invited_by, locale, expires_at, used_at)
                   VALUES ('inv-used', 'tok-used', 'hashed-tok-used', 'used@x.com',
                           '[1]', '["family"]', 'admin', 'en',
                           ${new Date(Date.now() + 86400_000).toISOString()},
                           ${new Date().toISOString()})`
      }) as Effect.Effect<void, never, never>,
    )
    const result = await callLoader(loader, { params: { token: "tok-used" } })
    const data = expectData<{ valid: boolean; error?: string }>(result)
    expect(data.valid).toBe(false)
    expect(data.error).toBe("already_used")
  })

  it("returns 'expired' when the invite's expiresAt is in the past", async () => {
    await seedTestDb(
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient
        yield* sql`INSERT INTO invites (id, token, token_hash, email, groups, group_names, invited_by, locale, expires_at)
                   VALUES ('inv-exp', 'tok-exp', 'hashed-tok-exp', 'exp@x.com',
                           '[1]', '["family"]', 'admin', 'en',
                           ${new Date(Date.now() - 86400_000).toISOString()})`
      }) as Effect.Effect<void, never, never>,
    )
    const result = await callLoader(loader, { params: { token: "tok-exp" } })
    const data = expectData<{ valid: boolean; error?: string }>(result)
    expect(data.valid).toBe(false)
    expect(data.error).toBe("expired")
  })
})

describe("/invite/:token/create-account action", () => {
  it("returns 'Missing invite token' when params.token is absent", async () => {
    const result = await callAction(action, { params: {} })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toBe("Missing invite token")
  })

  it("returns 'Invalid request origin' when origin check fails", async () => {
    const { isOriginAllowed } = await import("~/lib/config.server")
    vi.mocked(isOriginAllowed).mockReturnValue(false)

    const result = await callAction(action, {
      params: { token: "t1" },
      headers: { Origin: "http://evil" },
    })
    const data = expectData<{ error?: string }>(result)
    expect(data.error).toBe("Invalid request origin")
  })
})

// =============================================================================
// Component-render tests
// =============================================================================

import { screen, waitFor } from "@testing-library/react"
import CreateAccountPage from "./invite-create-account"
import { renderRoute } from "~/test/render-route"
import { server, http, HttpResponse } from "~/test/msw-server"
import { t } from "~/test/test-utils"

beforeEach(() => {
  server.use(http.get("*/health", () => HttpResponse.json({ ok: true })))
})

const renderCreateAccount = (loaderData: unknown, opts: { actionData?: unknown; url?: string } = {}) => {
  // Cast through `never` so TS doesn't enforce the full Route.ComponentProps
  // signature (params, matches, actionData) on the wrapper.
  const CreateAccountAny = CreateAccountPage as unknown as (props: {
    loaderData: unknown
    actionData: unknown
  }) => React.ReactElement
  const PageWithActionData = (props: { loaderData: unknown }) => (
    <CreateAccountAny loaderData={props.loaderData} actionData={opts.actionData} />
  )
  return renderRoute({
    route: {
      path: "/invite/:token/create-account",
      Component: PageWithActionData as never,
      loader: () => loaderData,
    },
    url: opts.url ?? "/invite/abc/create-account",
  })
}

describe("CreateAccountPage component", () => {
  it("renders the InviteErrorView for missing_token", async () => {
    renderCreateAccount({ valid: false, error: "missing_token", appName: "Duro", healthUrl: "/health" })
    // missing_token falls into the generic-error branch which uses
    // t("invite.error.title") for the heading.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: t("invite.error.title") })).toBeInTheDocument()
    })
  })

  it("renders the InviteErrorView with reinvite CTA when error is `expired`", async () => {
    renderCreateAccount(
      { valid: false, error: "expired", appName: "Duro", healthUrl: "/health" },
      { url: "/invite/tok-1/create-account" },
    )
    // Expired heading + a reinvite link.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: t("invite.expired.title") })).toBeInTheDocument()
    })
    expect(screen.getByRole("link")).toHaveAttribute("href", "/reinvite/tok-1")
  })

  it("renders the success view when actionData.success is true", async () => {
    renderCreateAccount(
      { valid: true, email: "alice@example.com", appName: "Duro", healthUrl: "/health" },
      { actionData: { success: true, homeUrl: "https://home.duro.example.com" } },
    )
    // Success branch uses t("createAccount.success.title") as the heading.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: t("createAccount.success.title") })).toBeInTheDocument()
    })
    expect(screen.getByRole("link")).toHaveAttribute("href", "https://home.duro.example.com")
  })

  it("renders the main form view when the invite is valid", async () => {
    renderCreateAccount({ valid: true, email: "alice@example.com", appName: "Duro", healthUrl: "/health" })
    // Valid branch uses t("createAccount.heading") as the page title.
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: t("createAccount.heading") })).toBeInTheDocument()
    })
    // Email is interpolated into the subtitle <Trans> — assert on the <p>
    // whose textContent contains the email.
    expect(
      screen.getByText((_, node) => node?.tagName === "P" && Boolean(node.textContent?.includes("alice@example.com"))),
    ).toBeInTheDocument()
  })
})
