// @vitest-environment node
import { describe, it, expect, beforeAll } from "vitest"
import { getAuth } from "./auth.server"
import { createSessionCookie } from "./session.server"

beforeAll(() => {
  process.env.SESSION_SECRET = "test-session-secret-must-be-32ch"
})

async function makeAuthenticatedRequest(session: {
  sub: string
  name: string
  email: string
  groups: string[]
}): Promise<Request> {
  const setCookie = await createSessionCookie(session)
  // Extract "name=value" from "name=value; HttpOnly; Secure; ..."
  const cookieValue = setCookie.split(";")[0]
  return new Request("http://localhost/", {
    headers: { cookie: cookieValue },
  })
}

describe("getAuth", () => {
  it("returns user and groups from session", async () => {
    const req = await makeAuthenticatedRequest({
      sub: "abc123",
      name: "alice",
      email: "alice@example.com",
      groups: ["lldap_admin", "media_users"],
    })
    const auth = await getAuth(req)
    expect(auth.user).toBe("alice")
    expect(auth.groups).toEqual(["lldap_admin", "media_users"])
  })

  it("returns null user when no session cookie", async () => {
    const req = new Request("http://localhost/")
    const auth = await getAuth(req)
    expect(auth.user).toBeNull()
    expect(auth.groups).toEqual([])
  })

  it("returns null user when session cookie is invalid", async () => {
    const req = new Request("http://localhost/", {
      headers: { cookie: "__duro_session=invalid-token" },
    })
    const auth = await getAuth(req)
    expect(auth.user).toBeNull()
    expect(auth.groups).toEqual([])
  })

  it("returns correct groups for admin user", async () => {
    const req = await makeAuthenticatedRequest({
      sub: "admin1",
      name: "admin",
      email: "admin@example.com",
      groups: ["lldap_admin", "users"],
    })
    const auth = await getAuth(req)
    expect(auth.groups.includes("lldap_admin")).toBe(true)
  })

  it("handles empty groups", async () => {
    const req = await makeAuthenticatedRequest({
      sub: "user1",
      name: "bob",
      email: "bob@example.com",
      groups: [],
    })
    const auth = await getAuth(req)
    expect(auth.user).toBe("bob")
    expect(auth.groups).toEqual([])
  })
})
