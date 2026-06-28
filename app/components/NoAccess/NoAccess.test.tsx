import { describe, it, expect } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { NoAccess } from "./NoAccess"
import { t } from "~/test/test-utils"
import type { AppCatalogEntry } from "~/lib/apps-catalog.server"

// Minimal fetcher stub (same shape RequestAccessForm reads).
const mkFetcher = () => ({
  state: "idle" as const,
  data: null,
  Form: ({ children }: { children?: React.ReactNode }) => <form>{children}</form>,
})

const mkApp = (id: string): AppCatalogEntry =>
  ({
    app: { id, slug: id, displayName: id },
    roles: [{ id: "r-viewer", applicationId: id, slug: "viewer", displayName: "Viewer", description: null }],
    requestableRoleIds: ["r-viewer"],
  }) as unknown as AppCatalogEntry

describe("NoAccess", () => {
  it("greets a known user and shows no request CTA without requestable apps", () => {
    render(<NoAccess user="alice" />)
    expect(screen.getByText(t("noAccess.title"))).toBeInTheDocument()
    expect(screen.getByText(t("noAccess.messageUser", undefined, { user: "alice" }))).toBeInTheDocument()
    expect(screen.queryByText(t("noAccess.requestCta"))).not.toBeInTheDocument()
  })

  it("uses the anonymous message when there is no user", () => {
    render(<NoAccess user={null} />)
    expect(screen.getByText(t("noAccess.messageAnon"))).toBeInTheDocument()
  })

  it("reveals the request form when the CTA is clicked", async () => {
    render(<NoAccess user="alice" requestableApps={[mkApp("jellyfin")]} fetcher={mkFetcher() as never} />)

    const cta = screen.getByRole("button", { name: t("noAccess.requestCta") })
    fireEvent.click(cta)

    await waitFor(() => {
      expect(screen.getByPlaceholderText(t("noAccess.form.applicationPlaceholder"))).toBeInTheDocument()
    })
  })
})
