import { describe, it, expect } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { createRoutesStub } from "react-router"
import { ToastProvider } from "@duro-app/ui"
import { ActionCell } from "./ActionCell"
import type { UserData } from "./UserColumns"

const row: UserData = {
  id: "daddy",
  displayName: "daddy",
  email: "daddy@example.com",
  creationDate: "2026-01-01T00:00:00Z",
  certs: [],
  isSystem: false,
  hasActiveCerts: false,
  activeCertCount: 0,
}

// Identity translator — returns the key so we can assert on which branch fired.
const t = (key: string) => key

function renderCell(actionResult: unknown) {
  const Stub = createRoutesStub([
    {
      path: "/",
      action: () => actionResult,
      // Wrap in ToastProvider — the Send Cert outcome now surfaces as a toast
      // (via useFetcherToast), not an inline alert.
      Component: () => (
        <ToastProvider>
          <ActionCell row={row} certPanelUserId={null} onRevoke={() => {}} onViewCerts={() => {}} t={t} />
        </ToastProvider>
      ),
    },
  ] as never)
  return render(<Stub initialEntries={["/"]} />)
}

describe("ActionCell — Send Cert feedback", () => {
  it("toasts success when the cert email was sent", async () => {
    renderCell({ success: true, message: "Certificate sent to daddy@example.com" })
    fireEvent.click(screen.getByRole("button", { name: "admin.users.actions.sendCert" }))
    const toast = await waitFor(() => screen.getByRole("status"))
    expect(toast).toHaveTextContent("admin.users.actions.certSent")
  })

  it("toasts an error when the send failed", async () => {
    renderCell({ error: "SMTP down" })
    fireEvent.click(screen.getByRole("button", { name: "admin.users.actions.sendCert" }))
    // certSendFailed carries the reason via interpolation; identity `t` returns
    // the bare key, which is enough to assert the error branch rendered.
    const toast = await waitFor(() => screen.getByRole("alert"))
    expect(toast).toHaveTextContent("admin.users.actions.certSendFailed")
  })
})
