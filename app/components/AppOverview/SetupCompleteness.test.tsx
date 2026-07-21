import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { SetupCompleteness, type SetupCriterion } from "./SetupCompleteness"
import { t } from "~/test/test-utils"

const IDS = ["owner", "description", "roles", "entitlements", "grants"] as const

function makeCriteria(done: Partial<Record<(typeof IDS)[number], boolean>> = {}): SetupCriterion[] {
  return IDS.map((id) => ({ id, done: done[id] ?? false, onFix: vi.fn() }))
}

describe("SetupCompleteness", () => {
  it("reports how many criteria are configured", () => {
    render(<SetupCompleteness criteria={makeCriteria({ owner: true, roles: true })} />)
    // The count is a separate <AnimatedNumber> node, but it and the static suffix
    // are text children of the same caption element, so its text reads together.
    expect(screen.getByText("2 of 5 configured")).toBeInTheDocument()
  })

  it("offers a fix action only for unmet criteria", () => {
    render(<SetupCompleteness criteria={makeCriteria({ roles: true })} />)
    // roles is met → no fix button; the other four are unmet → fix buttons present
    expect(screen.queryByRole("button", { name: t("admin.applications.setup.fix.roles") })).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: t("admin.applications.setup.fix.owner") })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: t("admin.applications.setup.fix.grants") })).toBeInTheDocument()
  })

  it("invokes onFix when its action is clicked", () => {
    const criteria = makeCriteria()
    render(<SetupCompleteness criteria={criteria} />)
    fireEvent.click(screen.getByRole("button", { name: t("admin.applications.setup.fix.entitlements") }))
    expect(criteria[3].onFix).toHaveBeenCalledOnce()
  })

  it("shows the celebratory complete state with no remaining actions", () => {
    render(
      <SetupCompleteness
        criteria={makeCriteria({ owner: true, description: true, roles: true, entitlements: true, grants: true })}
      />,
    )
    expect(screen.getByText(t("admin.applications.setup.complete"))).toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })

  // The first-run admin checklist reuses this component via i18nPrefix.
  describe("reused for the first-run checklist (i18nPrefix)", () => {
    const firstRun = (done: Record<string, boolean>): SetupCriterion[] =>
      ["firstApp", "firstGrant", "firstInvite"].map((id) => ({ id, done: done[id] ?? false, onFix: vi.fn() }))

    it("resolves copy from the passed namespace and shows the right progress", () => {
      render(<SetupCompleteness i18nPrefix="admin.firstRun" criteria={firstRun({ firstApp: true })} />)
      expect(screen.getByRole("heading", { name: t("admin.firstRun.title") })).toBeInTheDocument()
      expect(screen.getByText("1 of 3 done")).toBeInTheDocument()
      expect(screen.getByText(t("admin.firstRun.criteria.firstGrant"))).toBeInTheDocument()
      // met criterion has no fix; unmet ones jump to where they're fixed
      expect(screen.queryByRole("button", { name: t("admin.firstRun.fix.firstApp") })).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: t("admin.firstRun.fix.firstInvite") })).toBeInTheDocument()
    })

    it("shows the all-set state when every milestone is met", () => {
      render(
        <SetupCompleteness
          i18nPrefix="admin.firstRun"
          criteria={firstRun({ firstApp: true, firstGrant: true, firstInvite: true })}
        />,
      )
      expect(screen.getByText(t("admin.firstRun.complete"))).toBeInTheDocument()
    })
  })
})
