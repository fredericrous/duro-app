import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

// Static-source assertion: the C1 bug was that this route's action body
// duplicated bits of the workflow inline (recordDecision + updateStatus) and
// never invoked decideApproval. The fix wires it through the existing
// dispatcher in lib/mutations/admin-access-requests.ts. If a future refactor
// drops that delegation, this test fails before any user notices.
//
// We don't import the route module at runtime (its loader/action would pull
// in the full server stack); reading the source string keeps the assertion
// cheap and dependency-free.

const source = readFileSync(join(import.meta.dirname, "admin.access-requests.$id.tsx"), "utf8")

describe("admin.access-requests.$id route wiring", () => {
  it("delegates the action to handleAdminAccessRequestsMutation", () => {
    expect(source).toMatch(/handleAdminAccessRequestsMutation\(/)
  })

  it("does not call recordDecision directly from the action (regression for C1)", () => {
    // The legacy buggy path was `repo.recordDecision(...)` inside the action.
    // The dispatcher uses recordDecision under the hood, but the route file
    // itself should not — it should hand off to the mutation.
    expect(source).not.toMatch(/repo\.recordDecision\(/)
  })

  it("resolves approver via PrincipalRepo.findByExternalId (regression for C2)", () => {
    expect(source).toMatch(/findByExternalId\(/)
  })
})
