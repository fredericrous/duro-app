import { describe, expect, it } from "vitest"
import { loader } from "./admin.principals"

describe("/admin/principals (list merged into Identities)", () => {
  it("permanently redirects to /admin/identities", () => {
    const res = loader() as Response
    expect(res.status).toBe(301)
    expect(res.headers.get("Location")).toBe("/admin/identities")
  })
})
