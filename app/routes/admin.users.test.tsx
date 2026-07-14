import { describe, expect, it } from "vitest"
import { loader } from "./admin.users"

describe("/admin/users (merged into Identities)", () => {
  it("permanently redirects to /admin/identities", () => {
    const res = loader() as Response
    expect(res.status).toBe(301)
    expect(res.headers.get("Location")).toBe("/admin/identities")
  })
})
