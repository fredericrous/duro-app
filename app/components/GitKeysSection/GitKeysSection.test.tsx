import { describe, it, expect } from "vitest"
import { screen, waitFor, fireEvent } from "@testing-library/react"
import { GitKeysSection } from "./GitKeysSection"
import { renderRoute } from "~/test/render-route"
import { t } from "~/test/test-utils"
import type { GitSshKey } from "~/lib/services/ForgejoClient.server"

const KEY: GitSshKey = {
  id: 7,
  title: "Old laptop",
  fingerprint: "SHA256:abcdef",
  createdAt: "2026-01-01T00:00:00Z",
  keyType: "ssh-ed25519",
}

const VALID_PUBKEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIGJx2DEC1yJ8jEhSKKG2wUnGFbUvMW2WMbnUG6XY4LWW fred@laptop"
const PRIVATE_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaA==\n-----END OPENSSH PRIVATE KEY-----"

const renderSection = (props: Partial<Parameters<typeof GitKeysSection>[0]> = {}) =>
  renderRoute({
    route: {
      path: "/settings/git",
      Component: (() => (
        <GitKeysSection
          status="ready"
          keys={[]}
          username="fred"
          gitWebUrl="https://git.example.com"
          heading="Git access"
          {...props}
        />
      )) as never,
      loader: () => ({}),
      action: () => ({ gitKeyDeleted: true, keyId: 7 }),
    },
  })

describe("GitKeysSection — states", () => {
  it("account_missing: sign-in CTA + recheck, and NO add controls", async () => {
    renderSection({ status: "account_missing" })
    await waitFor(() => {
      expect(screen.getByText(t("settings.git.accountMissing.title"))).toBeInTheDocument()
    })
    const cta = screen.getByRole("link", { name: t("settings.git.openForge") })
    expect(cta).toHaveAttribute("href", "https://git.example.com")
    // Same tab unless the user opted into new tabs — see useLinkTarget.
    expect(cta).not.toHaveAttribute("target")
    expect(screen.getByRole("button", { name: t("settings.git.accountMissing.recheck") })).toBeInTheDocument()
    expect(screen.queryByText(t("settings.git.add.open"))).not.toBeInTheDocument()
  })

  it("unavailable: calm warning + retry, no add controls", async () => {
    renderSection({ status: "unavailable" })
    await waitFor(() => {
      expect(screen.getByText(t("settings.git.unavailable.title"))).toBeInTheDocument()
    })
    expect(screen.getByRole("button", { name: t("settings.git.unavailable.retry") })).toBeInTheDocument()
    expect(screen.queryByText(t("settings.git.add.open"))).not.toBeInTheDocument()
  })

  it("ready + empty: empty state with the add CTA", async () => {
    renderSection()
    await waitFor(() => {
      expect(screen.getByText(t("settings.git.empty.message"))).toBeInTheDocument()
    })
  })

  it("ready + keys: rows carry title, fingerprint, and a per-key delete label", async () => {
    renderSection({ keys: [KEY] })
    await waitFor(() => {
      expect(screen.getByText("Old laptop")).toBeInTheDocument()
    })
    expect(screen.getByText("SHA256:abcdef")).toBeInTheDocument()
    // distinct accessible name per row (the api-keys page gets this wrong)
    expect(
      screen.getByRole("button", { name: t("settings.git.list.deleteAria").replace("{{title}}", "Old laptop") }),
    ).toBeInTheDocument()
  })
})

describe("GitKeysSection — add form", () => {
  const openForm = async () => {
    renderSection()
    await waitFor(() => {
      expect(screen.getAllByText(t("settings.git.add.open")).length).toBeGreaterThan(0)
    })
    fireEvent.click(screen.getAllByRole("button", { name: t("settings.git.add.open") })[0])
    await waitFor(() => {
      expect(screen.getByLabelText(t("settings.git.add.keyLabel"))).toBeInTheDocument()
    })
  }

  it("pasting a PRIVATE key clears the field immediately and shows the panic panel", async () => {
    await openForm()
    const textarea = screen.getByLabelText(t("settings.git.add.keyLabel"))
    fireEvent.change(textarea, { target: { value: PRIVATE_KEY } })
    await waitFor(() => {
      expect(screen.getByText(t("settings.git.privateKey.title"))).toBeInTheDocument()
    })
    expect((textarea as HTMLTextAreaElement).value).toBe("")
    // nothing submittable either — the key field is empty again
    expect(screen.getByRole("button", { name: t("settings.git.add.submit") })).toBeDisabled()
  })

  it("a valid key prefills the title from its comment and enables submit", async () => {
    await openForm()
    const textarea = screen.getByLabelText(t("settings.git.add.keyLabel"))
    fireEvent.change(textarea, { target: { value: VALID_PUBKEY } })
    await waitFor(() => {
      expect((screen.getByLabelText(t("settings.git.add.titleLabel")) as HTMLInputElement).value).toBe("fred@laptop")
    })
    expect(screen.getByText(t("settings.git.add.titleAutofilled"))).toBeInTheDocument()
    expect(screen.getByRole("button", { name: t("settings.git.add.submit") })).toBeEnabled()
  })

  it("a malformed key shows the inline validation error on blur", async () => {
    await openForm()
    const textarea = screen.getByLabelText(t("settings.git.add.keyLabel"))
    fireEvent.change(textarea, { target: { value: "ssh-weird notakey" } })
    fireEvent.blur(textarea)
    await waitFor(() => {
      expect(screen.getByText(t("settings.git.validation.unsupported_type"))).toBeInTheDocument()
    })
  })
})

describe("GitKeysSection — delete", () => {
  it("delete opens a confirm dialog naming title and fingerprint", async () => {
    renderSection({ keys: [KEY] })
    await waitFor(() => {
      expect(screen.getByText("Old laptop")).toBeInTheDocument()
    })
    fireEvent.click(
      screen.getByRole("button", { name: t("settings.git.list.deleteAria").replace("{{title}}", "Old laptop") }),
    )
    await waitFor(() => {
      expect(screen.getByText(t("settings.git.delete.title"))).toBeInTheDocument()
    })
    expect(screen.getAllByText("SHA256:abcdef").length).toBeGreaterThan(1) // row + dialog
    expect(screen.getByRole("button", { name: t("settings.git.delete.confirm") })).toBeInTheDocument()
    // the localized cancel is passed explicitly (DS default would leak English)
    expect(screen.getAllByText(t("common.cancel")).length).toBeGreaterThan(0)
  })
})
