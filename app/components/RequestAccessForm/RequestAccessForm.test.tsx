import { describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { RequestAccessForm } from "./RequestAccessForm"
import { t } from "~/test/test-utils"
import type { AppCatalogEntry } from "~/lib/apps-catalog.server"

// Minimal Fetcher stub — the form only reads `state` and `data` and renders
// fetcher.Form, which is just a normal <form>. The component cares about
// idle/submitting + fetcher.data shape; nothing else.
type FetcherStub = {
  state: "idle" | "submitting"
  data: unknown
  Form: (props: { children?: React.ReactNode; method?: string; action?: string }) => React.ReactElement
}

const mkFetcher = (overrides: Partial<FetcherStub> = {}): FetcherStub => ({
  state: "idle",
  data: null,
  // Render as a plain form so the rest of the React tree composes normally.
  Form: ({ children, method, action }) => (
    <form method={method} action={action}>
      {children}
    </form>
  ),
  ...overrides,
})

const mkApp = (
  id: string,
  slug: string,
  displayName: string,
  roleIds: string[] = ["r-viewer"],
  requestableRoleIds: string[] = roleIds,
): AppCatalogEntry =>
  ({
    app: { id, slug, displayName },
    roles: roleIds.map((rid) => ({
      id: rid,
      applicationId: id,
      slug: rid.replace(/^r-/, ""),
      displayName: rid.replace(/^r-/, "").replace(/^./, (c) => c.toUpperCase()),
      description: null,
    })),
    requestableRoleIds,
  }) as unknown as AppCatalogEntry

describe("RequestAccessForm", () => {
  it("renders the application combobox + justification field by default", () => {
    render(<RequestAccessForm apps={[mkApp("app-1", "jellyfin", "Jellyfin")]} fetcher={mkFetcher() as never} />)
    expect(screen.getByPlaceholderText(t("noAccess.form.applicationPlaceholder"))).toBeInTheDocument()
    expect(screen.getByPlaceholderText(t("noAccess.form.justificationPlaceholder"))).toBeInTheDocument()
    // Two buttons: cancel + submit.
    expect(screen.getAllByRole("button")).toHaveLength(2)
  })

  it("hides the cancel button when hideCancel is set", () => {
    render(
      <RequestAccessForm apps={[mkApp("app-1", "jellyfin", "Jellyfin")]} fetcher={mkFetcher() as never} hideCancel />,
    )
    // Only the submit button remains.
    expect(screen.getAllByRole("button")).toHaveLength(1)
  })

  it("renders the hidden inputs the action handler reads", () => {
    const { container } = render(
      <RequestAccessForm apps={[mkApp("app-1", "jellyfin", "Jellyfin")]} fetcher={mkFetcher() as never} />,
    )
    // The form needs three hidden inputs the loader/action read on submit.
    expect(container.querySelector('input[name="intent"]')).toBeInTheDocument()
    expect(container.querySelector('input[name="applicationId"]')).toBeInTheDocument()
    expect(container.querySelector('input[name="roleId"]')).toBeInTheDocument()
    expect((container.querySelector('input[name="intent"]') as HTMLInputElement).value).toBe("requestAccess")
  })

  it("renders the success alert when fetcher.data signals `submitted`", () => {
    render(
      <RequestAccessForm
        apps={[mkApp("app-1", "jellyfin", "Jellyfin")]}
        fetcher={mkFetcher({ data: { outcome: "submitted" } }) as never}
      />,
    )
    // Form chrome is replaced by the success alert — no form fields visible.
    expect(screen.queryByPlaceholderText(/application/i)).not.toBeInTheDocument()
    // i18n key falls back to the key string itself when no translation, which
    // is what our i18n setup does in tests. Check that *some* alert text
    // referencing the success path rendered.
    expect(screen.getByRole("alert")).toBeInTheDocument()
  })

  it("renders the duplicate alert when fetcher.data signals `duplicate`", () => {
    render(
      <RequestAccessForm
        apps={[mkApp("app-1", "jellyfin", "Jellyfin")]}
        fetcher={mkFetcher({ data: { outcome: "duplicate" } }) as never}
      />,
    )
    expect(screen.getByRole("alert")).toBeInTheDocument()
  })

  it("renders an error alert when fetcher.data signals `error`", () => {
    render(
      <RequestAccessForm
        apps={[mkApp("app-1", "jellyfin", "Jellyfin")]}
        fetcher={mkFetcher({ data: { outcome: "error", error: "not_eligible" } }) as never}
      />,
    )
    expect(screen.getByRole("alert")).toBeInTheDocument()
    // Form is still rendered when the error is recoverable.
    expect(screen.getByPlaceholderText(t("noAccess.form.applicationPlaceholder"))).toBeInTheDocument()
  })

  it("disables submit while the fetcher is submitting", () => {
    render(
      <RequestAccessForm
        apps={[mkApp("app-1", "jellyfin", "Jellyfin")]}
        fetcher={mkFetcher({ state: "submitting" }) as never}
        preselectedAppId="app-1"
      />,
    )
    // With a preselected app + single requestable role auto-selected, submit
    // would otherwise be enabled; submitting flips it back to disabled. The
    // submit button is the only `type="submit"` button in the form.
    const submit = screen.getAllByRole("button").find((b) => (b as HTMLButtonElement).type === "submit")
    expect(submit).toBeDefined()
    expect(submit).toBeDisabled()
  })

  it("calls onCancel when the cancel button is clicked", async () => {
    const onCancel = vi.fn()
    const user = (await import("@testing-library/user-event")).default.setup()
    render(
      <RequestAccessForm
        apps={[mkApp("app-1", "jellyfin", "Jellyfin")]}
        fetcher={mkFetcher() as never}
        onCancel={onCancel}
      />,
    )
    // Cancel is the type="button" button (the other is type="submit").
    const cancel = screen.getAllByRole("button").find((b) => (b as HTMLButtonElement).type === "button")
    expect(cancel).toBeDefined()
    await user.click(cancel!)
    expect(onCancel).toHaveBeenCalledTimes(1)
  })
})
