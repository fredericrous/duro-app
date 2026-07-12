import { describe, it, expect } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"
import { createRoutesStub } from "react-router"
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
      Component: () => <ActionCell row={row} certPanelUserId={null} onRevoke={() => {}} onViewCerts={() => {}} t={t} />,
    },
  ] as never)
  return render(<Stub initialEntries={["/"]} />)
}

describe("ActionCell — Send Cert feedback", () => {
  it("shows a success alert when the cert email was sent", async () => {
    renderCell({ success: true, message: "Certificate sent to daddy@example.com" })
    fireEvent.click(screen.getByRole("button", { name: "admin.users.actions.sendCert" }))
    await waitFor(() => expect(screen.getByText("admin.users.actions.certSent")).toBeInTheDocument())
  })

  it("shows an error alert when the send failed", async () => {
    renderCell({ error: "SMTP down" })
    fireEvent.click(screen.getByRole("button", { name: "admin.users.actions.sendCert" }))
    // certSendFailed carries the reason via interpolation; identity `t` returns
    // the bare key, which is enough to assert the error branch rendered.
    await waitFor(() => expect(screen.getByText("admin.users.actions.certSendFailed")).toBeInTheDocument())
  })
})
