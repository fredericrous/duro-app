import { describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { createRoutesStub } from "react-router"
import { AdminDetailSurface } from "./AdminDetailSurface"
import { CertPanelContent } from "./CertPanelContent"
import { t as tt } from "~/test/test-utils"
import type { UserCertificate } from "~/lib/services/CertificateRepo.server"

const t = (key: string, opts?: Record<string, unknown>) => tt(key, undefined, opts)

const cert = (serialNumber: string): UserCertificate =>
  ({
    id: serialNumber,
    serialNumber,
    issuedAt: "2026-01-01T00:00:00Z",
    expiresAt: "2099-01-01T00:00:00Z",
    revokedAt: null,
    revokeState: null,
  }) as unknown as UserCertificate

const certs = [cert("AAAA1111BBBB2222CCCC"), cert("DDDD3333EEEE4444FFFF")]
const title = `${t("admin.users.actions.viewCerts")} — Alice`

let setWide: (wide: boolean) => void = () => {}
const onOpenChange = vi.fn()
const identitiesAction = vi.fn(async () => ({ success: true }))

// Mirrors production: the surface renders in the /admin layout, which has no
// action, while the content node is built once and handed to it, the way
// admin.identities stores it through setContent.
function Harness({ initialWide }: { initialWide: boolean }) {
  const [isWide, setIsWide] = useState(initialWide)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  setWide = setIsWide
  const toggleCert = (serial: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(serial)) next.delete(serial)
      else next.add(serial)
      return next
    })
  return (
    <AdminDetailSurface isWide={isWide} open onOpenChange={onOpenChange} label="Details">
      <CertPanelContent
        t={t}
        certPanelUser={{ displayName: "Alice" }}
        certPanelUserId="alice"
        certPanelCerts={certs}
        selectedCerts={selected}
        toggleCert={toggleCert}
        onClose={() => {}}
        onRevokeSelected={() => {}}
      />
    </AdminDetailSurface>
  )
}

const renderSurface = (initialWide: boolean) => {
  const Stub = createRoutesStub([
    {
      path: "/admin",
      Component: () => <Harness initialWide={initialWide} />,
      children: [{ path: "identities", action: identitiesAction }],
    },
  ])
  return render(<Stub initialEntries={["/admin"]} />)
}

describe("AdminDetailSurface", () => {
  it("renders the cert list in a side panel landmark on wide screens", async () => {
    renderSurface(true)
    const panel = await screen.findByRole("complementary", { name: title })
    expect(within(panel).getAllByRole("button", { name: t("admin.users.certs.revokeCert") })).toHaveLength(2)
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("renders the cert list in a dialog Drawer on narrow screens", async () => {
    renderSurface(false)
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(title)).toBeInTheDocument()
    expect(within(dialog).getAllByRole("button", { name: t("admin.users.certs.revokeCert") })).toHaveLength(2)
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument()
  })

  it("closes the Drawer through onOpenChange", async () => {
    onOpenChange.mockClear()
    renderSurface(false)
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getByRole("button", { name: t("admin.detailPanel.close") }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it("re-renders the same content node when the width crosses the breakpoint", async () => {
    renderSurface(true)
    await screen.findByRole("complementary", { name: title })
    act(() => setWide(false))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByText(title)).toBeInTheDocument()
    act(() => setWide(true))
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    expect(screen.getByRole("complementary", { name: title })).toBeInTheDocument()
  })

  it("ticks a certificate once per click and offers the batch revoke", async () => {
    renderSurface(false)
    const dialog = await screen.findByRole("dialog")
    const box = within(dialog).getByRole("checkbox", { name: certs[0].serialNumber })
    await userEvent.click(box)
    await waitFor(() => expect(box).toBeChecked())
    expect(
      within(dialog).getByRole("button", { name: t("admin.users.certs.revokeSelected", { count: 1 }) }),
    ).toBeInTheDocument()
  })

  it("posts a row's Revoke to the identities action, not the layout", async () => {
    identitiesAction.mockClear()
    renderSurface(false)
    const dialog = await screen.findByRole("dialog")
    await userEvent.click(within(dialog).getAllByRole("button", { name: t("admin.users.certs.revokeCert") })[0])
    await waitFor(() => expect(identitiesAction).toHaveBeenCalledTimes(1))
  })
})
