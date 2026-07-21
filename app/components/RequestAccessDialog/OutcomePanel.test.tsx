import { describe, it, expect, vi } from "vitest"
import { screen } from "@testing-library/react"
import { t } from "~/test/test-utils"
import { renderRoute } from "~/test/render-route"
import { OutcomePanel } from "./RequestAccessDialog"

const render = (props: Parameters<typeof OutcomePanel>[0]) =>
  renderRoute({
    route: {
      path: "/",
      Component: (() => <OutcomePanel {...props} />) as never,
      loader: () => ({}),
    },
  })

describe("OutcomePanel — request completion moment", () => {
  it("auto-approval shows 'Access granted' + a direct Open-app link to the app URL", async () => {
    render({ outcome: "auto_approved", appName: "Immich", appUrl: "https://immich.example", onClose: vi.fn() })
    expect(
      await screen.findByText(t("header.requestDialog.outcome.auto_approved", undefined, { app: "Immich" })),
    ).toBeInTheDocument()
    const open = screen.getByRole("link", {
      name: t("header.requestDialog.outcome.open", undefined, { app: "Immich" }),
    })
    expect(open).toHaveAttribute("href", "https://immich.example")
    // no "view requests" link on the granted path — the CTA is opening the app
    expect(screen.queryByRole("link", { name: t("header.requestDialog.outcome.viewRequests") })).toBeNull()
  })

  it("auto-approval without a launch URL falls back to the requests link (no Open button)", async () => {
    render({ outcome: "auto_approved", appName: "Docs", appUrl: undefined, onClose: vi.fn() })
    // Wait for the stub-router render to settle before the synchronous queries.
    await screen.findByText(t("header.requestDialog.outcome.auto_approved", undefined, { app: "Docs" }))
    expect(screen.queryByRole("link", { name: /Open Docs/ })).toBeNull()
    expect(screen.getByRole("link", { name: t("header.requestDialog.outcome.viewRequests") })).toBeInTheDocument()
  })

  it("submitted (pending) shows a pending confirmation + a way to track it", async () => {
    render({ outcome: "submitted", appName: "Plex", appUrl: "https://plex.example", onClose: vi.fn() })
    expect(
      await screen.findByText(t("header.requestDialog.outcome.submitted", undefined, { app: "Plex" })),
    ).toBeInTheDocument()
    // pending → don't offer to open the app yet, offer to track the request
    expect(screen.queryByRole("link", { name: /Open Plex/ })).toBeNull()
    expect(screen.getByRole("link", { name: t("header.requestDialog.outcome.viewRequests") })).toBeInTheDocument()
  })

  it("falls back to a generic app name when none is known", async () => {
    render({ outcome: "duplicate", appName: undefined, appUrl: undefined, onClose: vi.fn() })
    expect(
      await screen.findByText(
        t("header.requestDialog.outcome.duplicate", undefined, { app: t("header.requestDialog.outcome.thisApp") }),
      ),
    ).toBeInTheDocument()
  })
})
