import { describe, it, expect } from "vitest"
import { screen, waitFor, fireEvent } from "@testing-library/react"
import { ApiKeysSection } from "./ApiKeysSection"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"
import type { ApiKey } from "~/lib/governance/types"

const mkKey = (overrides: Partial<ApiKey>): ApiKey =>
  ({
    id: "k1",
    principalId: "p1",
    keyHash: "hash",
    keyPreview: "duro_ab…yz",
    name: "key",
    scopes: ["catalog.read"],
    expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
    revokedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }) as never as ApiKey

// ApiKeysSection consumes useFetcher, so it needs a data-router context;
// renderRoute supplies one via createRoutesStub.
const renderSection = (apiKeys: ApiKey[]) =>
  renderRoute({
    route: {
      path: "/settings",
      Component: (() => <ApiKeysSection apiKeys={apiKeys} />) as never,
      loader: () => ({}),
      action: () => ({ apiKeyRevoked: true }),
    },
  })

describe("ApiKeysSection", () => {
  it("renders the empty state when there are no keys", async () => {
    renderSection([])
    await waitFor(() => {
      expect(screen.getByText(t("settings.apiKeys.empty"))).toBeInTheDocument()
    })
    // The create form is always present.
    expect(screen.getByText(t("settings.apiKeys.create.heading"))).toBeInTheDocument()
  })

  it("renders active, expired, revoked and wildcard keys with the right status", async () => {
    renderSection([
      mkKey({ id: "active", name: "Active key", scopes: ["catalog.read"] }),
      mkKey({ id: "expired", name: "Expired key", expiresAt: "2000-01-01T00:00:00Z" }),
      mkKey({ id: "revoked", name: "Revoked key", revokedAt: "2026-02-01T00:00:00Z", scopes: ["*"] }),
    ])

    await waitFor(() => {
      expect(screen.getByText("Active key")).toBeInTheDocument()
    })
    expect(screen.getByText("Expired key")).toBeInTheDocument()
    expect(screen.getByText("Revoked key")).toBeInTheDocument()
    // Wildcard scope renders the warning chip rather than per-scope tags.
    expect(screen.getByText(t("settings.apiKeys.scopes.wildcardChip"))).toBeInTheDocument()
    // Status badges, one per key state.
    expect(screen.getByText(t("settings.apiKeys.status.active"))).toBeInTheDocument()
    expect(screen.getByText(t("settings.apiKeys.status.expired"))).toBeInTheDocument()
    expect(screen.getByText(t("settings.apiKeys.status.revoked"))).toBeInTheDocument()
  })

  it("opens the revoke confirmation dialog for an active key", async () => {
    renderSection([mkKey({ id: "active", name: "CI token", scopes: ["catalog.read"] })])

    const revokeBtn = await screen.findByRole("button", { name: t("settings.apiKeys.revoke") })
    fireEvent.click(revokeBtn)

    await waitFor(() => {
      expect(screen.getByText(t("settings.apiKeys.revokeConfirm.title"))).toBeInTheDocument()
    })
  })
})
