import { describe, it, expect } from "vitest"
import { screen, waitFor } from "@testing-library/react"
import RecoverPage from "./recover"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"

describe("RecoverPage", () => {
  it("renders the recovery request form", async () => {
    renderRoute({
      route: {
        path: "/recover",
        Component: RecoverPage as never,
        loader: () => ({ appName: "Duro" }),
        action: () => ({ submitted: true }),
      },
    })

    await waitFor(() => {
      expect(screen.getByRole("button", { name: t("recover.submit") })).toBeInTheDocument()
    })
    expect(screen.getByText(t("recover.title"))).toBeInTheDocument()
    expect(screen.getByPlaceholderText(t("recover.emailPlaceholder"))).toBeInTheDocument()
  })
})
