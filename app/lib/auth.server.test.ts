import { describe, it, expect } from "vitest"
import { parseAuthHeaders } from "./auth.server"

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/", { headers })
}

describe("parseAuthHeaders", () => {
  it("extracts user and groups from headers", () => {
    const req = makeRequest({
      "Remote-User": "alice",
      "Remote-Groups": "lldap_admin,media_users",
    })
    const auth = parseAuthHeaders(req)
    expect(auth.user).toBe("alice")
    expect(auth.groups).toEqual(["lldap_admin", "media_users"])
  })

  it("returns null user when Remote-User is missing", () => {
    const req = makeRequest()
    const auth = parseAuthHeaders(req)
    expect(auth.user).toBeNull()
    expect(auth.groups).toEqual([])
  })

  it("handles empty groups header", () => {
    const req = makeRequest({ "Remote-User": "bob", "Remote-Groups": "" })
    const auth = parseAuthHeaders(req)
    expect(auth.user).toBe("bob")
    expect(auth.groups).toEqual([])
  })

  it("trims whitespace from group names", () => {
    const req = makeRequest({
      "Remote-User": "alice",
      "Remote-Groups": " admin , users , ",
    })
    const auth = parseAuthHeaders(req)
    expect(auth.groups).toEqual(["admin", "users"])
  })
})
