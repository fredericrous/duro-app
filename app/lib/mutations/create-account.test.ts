import { describe, it, expect } from "vitest"
import { parseCreateAccountMutation } from "./create-account"

describe("parseCreateAccountMutation", () => {
  it("parses valid input", () => {
    const fd = new FormData()
    fd.append("username", "alice")
    fd.append("password", "supersecurepass")
    fd.append("confirmPassword", "supersecurepass")

    const result = parseCreateAccountMutation(fd, "tok-123")
    expect(result).toEqual({ token: "tok-123", username: "alice", password: "supersecurepass" })
  })

  it("rejects short username", () => {
    const fd = new FormData()
    fd.append("username", "ab")
    fd.append("password", "supersecurepass")
    fd.append("confirmPassword", "supersecurepass")

    const result = parseCreateAccountMutation(fd, "tok-123")
    expect(result).toHaveProperty("error")
    expect((result as any).error).toContain("3-32 characters")
  })

  it("rejects invalid username characters", () => {
    const fd = new FormData()
    fd.append("username", "alice smith!")
    fd.append("password", "supersecurepass")
    fd.append("confirmPassword", "supersecurepass")

    const result = parseCreateAccountMutation(fd, "tok-123")
    expect(result).toHaveProperty("error")
  })

  it("rejects short password", () => {
    const fd = new FormData()
    fd.append("username", "alice")
    fd.append("password", "short")
    fd.append("confirmPassword", "short")

    const result = parseCreateAccountMutation(fd, "tok-123")
    expect(result).toHaveProperty("error")
    expect((result as any).error).toContain("12 characters")
  })

  it("rejects mismatched passwords", () => {
    const fd = new FormData()
    fd.append("username", "alice")
    fd.append("password", "supersecurepass")
    fd.append("confirmPassword", "differentpassword")

    const result = parseCreateAccountMutation(fd, "tok-123")
    expect(result).toEqual({ error: "Passwords do not match" })
  })

  it("trims username whitespace", () => {
    const fd = new FormData()
    fd.append("username", "  alice  ")
    fd.append("password", "supersecurepass")
    fd.append("confirmPassword", "supersecurepass")

    const result = parseCreateAccountMutation(fd, "tok-123")
    expect(result).toEqual({ token: "tok-123", username: "alice", password: "supersecurepass" })
  })
})
