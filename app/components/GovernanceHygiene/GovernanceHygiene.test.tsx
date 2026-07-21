import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { GovernanceHygiene, type HygieneFinding } from "./GovernanceHygiene"
import { t } from "~/test/test-utils"

const finding = (id: string, count: number, onFix = vi.fn()): HygieneFinding => ({ id, count, onFix })

describe("GovernanceHygiene", () => {
  it("lists only findings with a non-zero count, pluralized", () => {
    render(
      <GovernanceHygiene
        findings={[
          finding("apps_without_owner", 2),
          finding("enabled_apps_without_role", 0), // clear → not shown
          finding("stale_invitations", 1),
        ]}
      />,
    )
    expect(
      screen.getByText(t("admin.hygiene.findings.apps_without_owner", undefined, { count: 2 })),
    ).toBeInTheDocument()
    // singular form for count 1
    expect(screen.getByText(t("admin.hygiene.findings.stale_invitations", undefined, { count: 1 }))).toBeInTheDocument()
    // the cleared criterion is absent entirely
    expect(screen.queryByText(/no roles/)).toBeNull()
    expect(screen.queryByText(t("admin.hygiene.allClear"))).toBeNull()
  })

  it("offers a one-click fix jump per active finding", () => {
    const onFix = vi.fn()
    render(<GovernanceHygiene findings={[finding("apps_without_owner", 3, onFix)]} />)
    fireEvent.click(screen.getByRole("button", { name: t("admin.hygiene.fix.apps_without_owner") }))
    expect(onFix).toHaveBeenCalledOnce()
  })

  it("shows a quiet all-clear (no actions) when nothing needs attention", () => {
    render(<GovernanceHygiene findings={[finding("apps_without_owner", 0), finding("stale_invitations", 0)]} />)
    expect(screen.getByText(t("admin.hygiene.allClear"))).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()
  })
})
